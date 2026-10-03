-- Re-ordering for operational inventory, and the low-stock alert.
--
-- An item at or below its re-order level shows on the Re-order tab
-- (/admin/inventory/reorder) with a suggested number of whole lots. An admin
-- marks it ordered (`inventory_orders`), which takes it off the "needs
-- ordering" list and stops further low-stock alerts for it; when the delivery
-- arrives, whoever unpacks it marks the order received into a storage area,
-- which posts the `receive` to the ledger in the same transaction.
--
-- Also adds the `inventory_low` notification kind: admins hear when an item
-- drops to its re-order level with nothing on order.

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

create table public.inventory_orders (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items (id) on delete restrict,
  -- how many lots were ordered, and the units that comes to at the item's
  -- lot size when ordered (lot sizes can change later)
  lots numeric not null check (lots > 0),
  units numeric not null check (units > 0),
  -- the unit cost when ordered, for the order's estimated value
  unit_cost_cents integer check (unit_cost_cents >= 0),
  -- ordered: on its way; received: arrived and put away; cancelled: never came
  status text not null default 'ordered' check (status in ('ordered', 'received', 'cancelled')),
  note text check (char_length(note) <= 500),
  ordered_by text not null,
  ordered_at timestamptz not null default now(),
  -- set when received: who, when, how many actually arrived, and where they
  -- were put (the receive movement says the same; these keep the order whole)
  received_by text,
  received_at timestamptz,
  received_units numeric check (received_units > 0),
  received_area_id uuid references public.inventory_areas (id) on delete restrict,
  cancelled_by text,
  cancelled_at timestamptz,
  check ((status = 'received') = (received_at is not null)),
  check ((status = 'cancelled') = (cancelled_at is not null))
);

-- At most one open order per item: "mark ordered" is a state, not a log.
create unique index inventory_orders_open_item_idx
  on public.inventory_orders (item_id)
  where status = 'ordered';

create index inventory_orders_status_idx
  on public.inventory_orders (status, ordered_at desc);

-- Which order a receive movement came from (null for an ad-hoc receive).
alter table public.inventory_movements
  add column order_id uuid references public.inventory_orders (id) on delete restrict;

-- ---------------------------------------------------------------------------
-- Receiving an order
-- ---------------------------------------------------------------------------

-- Marks an open order received and posts the receive to the ledger, in one
-- transaction. `p_units` is what actually arrived (it can differ from what
-- was ordered). Raises (P0001) with a readable message if the order is not
-- open or the area is retired.
create or replace function public.inventory_receive_order(
  p_order_id uuid,
  p_area_id uuid,
  p_units numeric,
  p_received_by text
)
returns public.inventory_orders
language plpgsql
as $$
declare
  v_order public.inventory_orders;
  v_cost integer;
begin
  if p_units is null or p_units <= 0 then
    raise exception 'Enter how many arrived' using errcode = 'P0001';
  end if;

  select * into v_order from public.inventory_orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0001';
  end if;
  if v_order.status <> 'ordered' then
    raise exception 'This order is already %', v_order.status using errcode = 'P0001';
  end if;

  perform 1 from public.inventory_areas where id = p_area_id and active;
  if not found then
    raise exception 'Storage area not found' using errcode = 'P0001';
  end if;

  -- The item's current cost, like any other receive.
  select unit_cost_cents into v_cost from public.inventory_items where id = v_order.item_id;

  insert into public.inventory_movements (
    item_id, area_id, movement_type, quantity, unit_cost_cents, order_id, recorded_by
  )
  values (
    v_order.item_id, p_area_id, 'receive', p_units, v_cost, v_order.id, p_received_by
  );

  update public.inventory_orders
  set status = 'received',
      received_by = p_received_by,
      received_at = now(),
      received_units = p_units,
      received_area_id = p_area_id
  where id = v_order.id
  returning * into v_order;

  return v_order;
end;
$$;

-- Only the app's service role calls this; it trusts p_received_by.
revoke all on function public.inventory_receive_order(uuid, uuid, numeric, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The low-stock notification kind
-- ---------------------------------------------------------------------------

alter table public.staff_notifications drop constraint staff_notifications_kind_check;
alter table public.staff_notifications
  add constraint staff_notifications_kind_check check (
    kind in (
      'admin_message',
      'message_reply',
      'sop_updated',
      'schedule_change',
      'shift_note_reply',
      'sub_request',
      'goal_activity',
      'agent_suggestion',
      'inventory_low'
    )
  );

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

-- App access is service-role (bypasses RLS); this admin-select policy is
-- forward-looking convention, same as the other inventory tables.
alter table public.inventory_orders enable row level security;

create policy "admins can select inventory orders"
  on public.inventory_orders for select to authenticated using (public.is_admin());

comment on table public.inventory_orders is
  'Re-orders from /admin/inventory/reorder. One open (ordered) order per item; receiving goes through inventory_receive_order, which posts the receive movement.';
