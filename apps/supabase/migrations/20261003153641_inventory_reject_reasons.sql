-- Rejected deliveries can have more than one reason.
--
-- 20261003000623_inventory_rejects.sql gave each reject a single `reason`, so
-- a load that came back both stained and torn had to pick one (or be typed as
-- "Stained, torn", which the Rejects tab can't count by reason). Staff now
-- tick every reason that applies on the receive form.
--
-- Steps:
--   1. add inventory_rejects.reasons (text[]), filled from the old reason;
--   2. drop the single reason column;
--   3. replace inventory_record_delivery so it takes p_reasons text[] in place
--      of p_reason text (same transaction and checks otherwise).

-- ---------------------------------------------------------------------------
-- 1–2. One reason → a list of reasons
-- ---------------------------------------------------------------------------

alter table public.inventory_rejects add column reasons text[];

update public.inventory_rejects set reasons = array[btrim(reason)];

alter table public.inventory_rejects
  alter column reasons set not null,
  -- at least one reason, each 1–120 characters, at most eight of them
  -- ("Stained", "Torn", "Wet", "Damaged", "Wrong item", plus free text)
  add constraint inventory_rejects_reasons_check check (
    cardinality(reasons) between 1 and 8
    and array_position(reasons, null) is null
    and length(array_to_string(reasons, '')) <= 8 * 120
  );

comment on column public.inventory_rejects.reasons is
  'Why the units were rejected — every reason that applied ("Stained", "Torn", or free text), trimmed and de-duplicated by inventory_record_delivery.';

alter table public.inventory_rejects drop column reason;

-- ---------------------------------------------------------------------------
-- 3. Recording a delivery takes a list of reasons
-- ---------------------------------------------------------------------------

drop function if exists public.inventory_record_delivery(
  uuid, uuid, numeric, numeric, text, text, uuid, uuid[], text
);

-- Records one delivery of one item, in one transaction:
--   * p_accepted units go into p_area_id as a `receive` (when > 0)
--   * p_rejected units become an inventory_rejects row (when > 0; needs at
--     least one reason in p_reasons), held for pickup and pending credit
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
  p_reasons text[],
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
  -- trimmed, blanks dropped, duplicates (case-insensitive) dropped, in the
  -- order they were picked
  v_reasons text[];
begin
  select coalesce(array_agg(r order by first_pos), '{}')
  into v_reasons
  from (
    select distinct on (lower(btrim(raw))) btrim(raw) as r, pos as first_pos
    from unnest(coalesce(p_reasons, '{}')) with ordinality as u (raw, pos)
    where length(btrim(coalesce(raw, ''))) > 0
    order by lower(btrim(raw)), pos
  ) cleaned;

  if v_accepted < 0 or v_rejected < 0 then
    raise exception 'Quantities can''t be negative' using errcode = 'P0001';
  end if;
  if v_accepted + v_rejected <= 0 then
    raise exception 'Enter how many arrived' using errcode = 'P0001';
  end if;
  if v_rejected > 0 and cardinality(v_reasons) = 0 then
    raise exception 'Say why they were rejected' using errcode = 'P0001';
  end if;
  if cardinality(v_reasons) > 8 then
    raise exception 'Pick at most 8 reasons' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(v_reasons) r where char_length(r) > 120) then
    raise exception 'Keep each reason under 120 characters' using errcode = 'P0001';
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
      item_id, order_id, movement_id, delivered_qty, rejected_qty, reasons, note,
      unit_cost_cents, vendor, received_by
    )
    values (
      p_item_id, p_order_id, v_movement_id, v_accepted + v_rejected, v_rejected,
      v_reasons, nullif(btrim(coalesce(p_note, '')), ''),
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
  uuid, uuid, numeric, numeric, text[], text, uuid, uuid[], text
) from public, anon, authenticated;
