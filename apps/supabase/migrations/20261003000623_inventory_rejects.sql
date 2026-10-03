-- Rejected deliveries: towels that arrive stained or torn, held on site until
-- the driver takes them back at the next delivery, and credited by the vendor.
--
-- Rejects never enter stock and are never loss — we never had them. Each
-- delivery that comes with rejects gets an `inventory_rejects` row: how many
-- came, how many were turned away and why, and what they were worth. The row
-- then moves through two independent steps:
--
--   pickup  — held (picked_up_at null) until the vendor takes them back;
--             staff are prompted to confirm it when the next delivery of that
--             item is received
--   credit  — pending until an admin marks it credited (with the amount) or
--             denied
--
-- Receiving now goes through one function, `inventory_record_delivery`, for
-- both a delivery logged on the stock screen and an order received from the
-- Re-order tab: it posts the accepted units as a `receive`, records the
-- rejects, marks any held rejects picked up, and closes the order — all in
-- one transaction. It replaces `inventory_receive_order`.

create table public.inventory_rejects (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items (id) on delete restrict,
  -- the re-order this delivery filled, if it came through the Re-order tab
  order_id uuid references public.inventory_orders (id) on delete restrict,
  -- the receive movement for the accepted part (null when all were rejected)
  movement_id uuid references public.inventory_movements (id) on delete restrict,
  -- the whole delivery (accepted + rejected), for the reject rate
  delivered_qty numeric not null check (delivered_qty > 0),
  rejected_qty numeric not null check (rejected_qty > 0 and rejected_qty <= delivered_qty),
  -- why: "Stained", "Torn", "Wet", "Wrong item", or free text
  reason text not null check (length(btrim(reason)) between 1 and 120),
  note text check (char_length(note) <= 1000),
  -- unit cost and vendor when it happened, so the credit owed is historic
  unit_cost_cents integer check (unit_cost_cents >= 0),
  vendor text check (char_length(vendor) <= 120),
  received_by text not null,
  received_at timestamptz not null default now(),

  -- pickup: held on site until the vendor takes them back
  picked_up_at timestamptz,
  picked_up_by text,

  -- credit from the vendor
  credit_status text not null default 'pending' check (credit_status in ('pending', 'credited', 'denied')),
  credit_cents integer check (credit_cents >= 0),
  credit_note text check (char_length(credit_note) <= 500),
  credited_by text,
  credited_at timestamptz,

  check ((picked_up_at is null) = (picked_up_by is null)),
  check ((credit_status = 'pending') = (credited_at is null)),
  check (credit_status <> 'credited' or credit_cents is not null)
);

create index inventory_rejects_item_idx on public.inventory_rejects (item_id, received_at desc);
create index inventory_rejects_received_idx on public.inventory_rejects (received_at desc);
create index inventory_rejects_held_idx
  on public.inventory_rejects (item_id)
  where picked_up_at is null;
create index inventory_rejects_credit_idx
  on public.inventory_rejects (received_at)
  where credit_status = 'pending';

-- An order whose whole delivery was rejected is still received (of nothing).
alter table public.inventory_orders drop constraint inventory_orders_received_units_check;
alter table public.inventory_orders
  add constraint inventory_orders_received_units_check check (received_units >= 0);

-- ---------------------------------------------------------------------------
-- Recording a delivery
-- ---------------------------------------------------------------------------

drop function if exists public.inventory_receive_order(uuid, uuid, numeric, text);

-- Records one delivery of one item, in one transaction:
--   * p_accepted units go into p_area_id as a `receive` (when > 0)
--   * p_rejected units become an inventory_rejects row (when > 0; needs a
--     reason), held for pickup and pending credit
--   * p_pickup_ids: held rejects of this item the driver took back with this
--     delivery, marked picked up
--   * p_order_id: the open re-order this delivery fills, marked received
-- Returns { movement_id, reject_id, order_id }. Raises (P0001) with a readable
-- message for anything it refuses.
create or replace function public.inventory_record_delivery(
  p_item_id uuid,
  p_area_id uuid,
  p_accepted numeric,
  p_rejected numeric,
  p_reason text,
  p_note text,
  p_order_id uuid,
  p_pickup_ids uuid[],
  p_received_by text
)
returns jsonb
language plpgsql
as $$
declare
  v_item public.inventory_items;
  v_order public.inventory_orders;
  v_movement_id uuid;
  v_reject_id uuid;
  v_accepted numeric := coalesce(p_accepted, 0);
  v_rejected numeric := coalesce(p_rejected, 0);
begin
  if v_accepted < 0 or v_rejected < 0 then
    raise exception 'Quantities can''t be negative' using errcode = 'P0001';
  end if;
  if v_accepted + v_rejected <= 0 then
    raise exception 'Enter how many arrived' using errcode = 'P0001';
  end if;
  if v_rejected > 0 and length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Say why they were rejected' using errcode = 'P0001';
  end if;

  select * into v_item from public.inventory_items where id = p_item_id and active;
  if not found then
    raise exception 'Item not found' using errcode = 'P0001';
  end if;
  perform 1 from public.inventory_areas where id = p_area_id and active;
  if not found then
    raise exception 'Storage area not found' using errcode = 'P0001';
  end if;

  if p_order_id is not null then
    select * into v_order from public.inventory_orders where id = p_order_id for update;
    if not found then
      raise exception 'Order not found' using errcode = 'P0001';
    end if;
    if v_order.status <> 'ordered' then
      raise exception 'This order is already %', v_order.status using errcode = 'P0001';
    end if;
    if v_order.item_id <> p_item_id then
      raise exception 'That order is for a different item' using errcode = 'P0001';
    end if;
  end if;

  if v_accepted > 0 then
    insert into public.inventory_movements (
      item_id, area_id, movement_type, quantity, unit_cost_cents, order_id, recorded_by
    )
    values (
      p_item_id, p_area_id, 'receive', v_accepted, v_item.unit_cost_cents, p_order_id, p_received_by
    )
    returning id into v_movement_id;
  end if;

  if v_rejected > 0 then
    insert into public.inventory_rejects (
      item_id, order_id, movement_id, delivered_qty, rejected_qty, reason, note,
      unit_cost_cents, vendor, received_by
    )
    values (
      p_item_id, p_order_id, v_movement_id, v_accepted + v_rejected, v_rejected,
      btrim(p_reason), nullif(btrim(coalesce(p_note, '')), ''),
      v_item.unit_cost_cents, v_item.vendor, p_received_by
    )
    returning id into v_reject_id;
  end if;

  if p_pickup_ids is not null and cardinality(p_pickup_ids) > 0 then
    update public.inventory_rejects
    set picked_up_at = now(), picked_up_by = p_received_by
    where id = any (p_pickup_ids)
      and item_id = p_item_id
      and picked_up_at is null
      -- not the reject recorded by this very delivery
      and id is distinct from v_reject_id;
  end if;

  if p_order_id is not null then
    update public.inventory_orders
    set status = 'received',
        received_by = p_received_by,
        received_at = now(),
        received_units = v_accepted,
        received_area_id = p_area_id
    where id = p_order_id;
  end if;

  return jsonb_build_object(
    'movement_id', v_movement_id,
    'reject_id', v_reject_id,
    'order_id', p_order_id
  );
end;
$$;

-- Only the app's service role calls this; it trusts p_received_by.
revoke all on function public.inventory_record_delivery(
  uuid, uuid, numeric, numeric, text, text, uuid, uuid[], text
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

-- App access is service-role (bypasses RLS); this admin-select policy is
-- forward-looking convention, same as the other inventory tables.
alter table public.inventory_rejects enable row level security;

create policy "admins can select inventory rejects"
  on public.inventory_rejects for select to authenticated using (public.is_admin());

comment on table public.inventory_rejects is
  'Rejected units from a delivery: never in stock, held on site until the vendor picks them up, and pending credit until an admin marks it credited or denied. Written by inventory_record_delivery.';
