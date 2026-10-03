-- Inventory units become a configured list, with their plurals.
--
-- Items have counted in a free-text `unit` ("towel", "Towels", "btl") and been
-- bought by a free-text `lot_label` ("case", "box"), and the app pluralised
-- both by adding an "s" — which gives "boxs" and can't tell "each" from
-- "eachs". Units are now rows admins manage on /admin/inventory/setup: each
-- has its singular and plural spelled out ("box" / "boxes", "each" / "each"),
-- a display order, and can be retired. The item form picks the counting unit
-- and the lot unit from the same drop-down.
--
-- Steps:
--   1. create inventory_units;
--   2. turn every distinct unit and lot label already typed into a row
--      (matched case-insensitively), with a suggested plural an admin can fix;
--   3. point items at them through unit_id / lot_unit_id;
--   4. keep the item's text `unit` / `lot_label` and new `unit_plural` /
--      `lot_label_plural` in step with the chosen rows by trigger, so every
--      screen, report, and notification that reads the item's unit keeps
--      working and now has the right plural;
--   5. replace inventory_create_product / inventory_add_variant (from
--      20261003154658_inventory_variants.sql) to set units by id.

-- ---------------------------------------------------------------------------
-- 1. The list
-- ---------------------------------------------------------------------------

create table public.inventory_units (
  id uuid primary key default gen_random_uuid(),
  -- one of it: "bottle", "box", "each"
  name text not null check (length(btrim(name)) between 1 and 30),
  -- more than one: "bottles", "boxes", "each"
  plural text not null check (length(btrim(plural)) between 1 and 30),
  -- display order in the drop-down and the setup list (ascending)
  sort_order integer not null default 0,
  -- retired units stay on the items that have them but are no longer offered
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index inventory_units_active_name_idx
  on public.inventory_units (lower(btrim(name)))
  where active;

create trigger inventory_units_set_updated_at
  before update on public.inventory_units
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Carry over the units already typed
-- ---------------------------------------------------------------------------

-- One row per distinct spelling (case- and space-insensitive) across both
-- columns, spelled the way it was first entered, ordered alphabetically.
--
-- The plural is a first guess (the setup form suggests one the same way, and
-- an admin can correct it). A word already ending in a single "s" was usually
-- typed as a plural ("towels"), and the app has always shown it unchanged, so
-- it stays as it is.
insert into public.inventory_units (name, plural, sort_order, created_by)
select
  name,
  case
    when lower(name) in ('each', 'dozen') then name
    when name ~* '(ss|x|z|ch|sh)$' then name || 'es'
    when name ~* 's$' then name
    when name ~* '[^aeiou]y$' then left(name, -1) || 'ies'
    else name || 's'
  end,
  row_number() over (order by lower(name)),
  'migration'
from (
  select distinct on (lower(word)) word as name
  from (
    select btrim(unit) as word, created_at from public.inventory_items
    union all
    select btrim(lot_label), created_at from public.inventory_items
    where length(btrim(coalesce(lot_label, ''))) > 0
  ) typed
  order by lower(word), created_at
) existing;

-- ---------------------------------------------------------------------------
-- 3. Items reference units by id
-- ---------------------------------------------------------------------------

alter table public.inventory_items
  add column unit_id uuid references public.inventory_units (id) on delete restrict,
  add column lot_unit_id uuid references public.inventory_units (id) on delete restrict,
  -- copies of the chosen units' plurals, kept by inventory_items_sync_units
  add column unit_plural text,
  add column lot_label_plural text;

update public.inventory_items i
set unit_id = u.id, unit = u.name, unit_plural = u.plural
from public.inventory_units u
where lower(btrim(i.unit)) = lower(u.name);

update public.inventory_items i
set lot_unit_id = u.id, lot_label = u.name, lot_label_plural = u.plural
from public.inventory_units u
where lower(btrim(i.lot_label)) = lower(u.name);

alter table public.inventory_items
  alter column unit_id set not null,
  alter column unit_plural set not null,
  -- the text copies are now written only by the trigger below
  alter column unit drop default;

comment on column public.inventory_items.unit_id is
  'What the item is counted in, from inventory_units. unit / unit_plural are trigger-kept copies of its name and plural.';
comment on column public.inventory_items.lot_unit_id is
  'What the item is bought by ("case"), from inventory_units; null = bought one at a time. lot_label / lot_label_plural are trigger-kept copies.';

create index inventory_items_unit_idx on public.inventory_items (unit_id);
create index inventory_items_lot_unit_idx on public.inventory_items (lot_unit_id);

-- ---------------------------------------------------------------------------
-- 4. Keep the text copies in step
-- ---------------------------------------------------------------------------

create or replace function public.inventory_items_sync_units()
returns trigger
language plpgsql
as $$
declare
  v_unit public.inventory_units;
begin
  select * into v_unit from public.inventory_units where id = new.unit_id;
  if not found then
    raise exception 'Pick a unit' using errcode = 'P0001';
  end if;
  new.unit := v_unit.name;
  new.unit_plural := v_unit.plural;

  if new.lot_unit_id is null then
    new.lot_label := null;
    new.lot_label_plural := null;
  else
    select * into v_unit from public.inventory_units where id = new.lot_unit_id;
    if not found then
      raise exception 'Pick how it''s bought' using errcode = 'P0001';
    end if;
    new.lot_label := v_unit.name;
    new.lot_label_plural := v_unit.plural;
  end if;
  return new;
end;
$$;

create trigger inventory_items_sync_units
  before insert or update on public.inventory_items
  for each row execute function public.inventory_items_sync_units();

-- Renaming a unit or fixing its plural carries to every item using it.
create or replace function public.inventory_units_cascade()
returns trigger
language plpgsql
as $$
begin
  if new.name is distinct from old.name or new.plural is distinct from old.plural then
    update public.inventory_items
    set updated_at = now()
    where unit_id = new.id or lot_unit_id = new.id;
  end if;
  return new;
end;
$$;

create trigger inventory_units_cascade
  after update on public.inventory_units
  for each row execute function public.inventory_units_cascade();

-- ---------------------------------------------------------------------------
-- 5. Products and variants set units by id
-- ---------------------------------------------------------------------------

-- Adds a product and one item per label in p_variants (in that order), each
-- with the shared settings in p_item (the inventory_items columns the item
-- form sets: unit_id, lot_size, lot_unit_id, reorder_level, reorder_target,
-- unit_cost_cents, vendor, vendor_url, notes) and kept in every area in
-- p_area_ids, with nothing on hand yet. Returns { product_id, item_ids }.
-- Raises (P0001) with a readable message for anything it refuses.
create or replace function public.inventory_create_product(
  p_name text,
  p_category_id uuid,
  p_variants text[],
  p_item jsonb,
  p_area_ids uuid[],
  p_created_by text
)
returns jsonb
language plpgsql
as $$
declare
  v_product_id uuid;
  v_item_id uuid;
  v_item_ids uuid[] := '{}';
  v_variant text;
  v_order integer := 0;
  v_area_id uuid;
  v_area_order integer;
begin
  if length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'Name the product' using errcode = 'P0001';
  end if;
  if coalesce(cardinality(p_variants), 0) = 0 then
    raise exception 'Add at least one variant' using errcode = 'P0001';
  end if;
  if p_item ->> 'unit_id' is null then
    raise exception 'Pick a unit' using errcode = 'P0001';
  end if;
  if p_category_id is not null then
    perform 1 from public.inventory_categories where id = p_category_id and active;
    if not found then
      raise exception 'That category no longer exists' using errcode = 'P0001';
    end if;
  end if;
  if p_area_ids is not null and cardinality(p_area_ids) > 0 then
    if (select count(*) from public.inventory_areas where id = any (p_area_ids) and active)
       <> cardinality(array(select distinct unnest(p_area_ids))) then
      raise exception 'One of the storage areas no longer exists' using errcode = 'P0001';
    end if;
  end if;

  insert into public.inventory_products (name, category_id, created_by)
  values (btrim(p_name), p_category_id, p_created_by)
  returning id into v_product_id;

  foreach v_variant in array p_variants loop
    if length(btrim(coalesce(v_variant, ''))) = 0 then
      raise exception 'Variant names can''t be blank' using errcode = 'P0001';
    end if;
    v_order := v_order + 1;
    insert into public.inventory_items (
      name, product_id, variant, variant_order, unit_id, lot_size, lot_unit_id,
      reorder_level, reorder_target, unit_cost_cents, vendor, vendor_url, notes,
      created_by
    )
    values (
      -- recomputed by inventory_items_sync_variant
      btrim(p_name), v_product_id, v_variant, v_order,
      (p_item ->> 'unit_id')::uuid,
      coalesce((p_item ->> 'lot_size')::numeric, 1),
      (p_item ->> 'lot_unit_id')::uuid,
      (p_item ->> 'reorder_level')::numeric,
      (p_item ->> 'reorder_target')::numeric,
      (p_item ->> 'unit_cost_cents')::integer,
      p_item ->> 'vendor',
      p_item ->> 'vendor_url',
      p_item ->> 'notes',
      p_created_by
    )
    returning id into v_item_id;
    v_item_ids := v_item_ids || v_item_id;

    v_area_order := 0;
    foreach v_area_id in array coalesce(p_area_ids, '{}') loop
      insert into public.inventory_item_spots (item_id, area_id, sort_order)
      values (v_item_id, v_area_id, v_area_order)
      on conflict (item_id, area_id) do nothing;
      v_area_order := v_area_order + 1;
    end loop;
  end loop;

  return jsonb_build_object('product_id', v_product_id, 'item_ids', to_jsonb(v_item_ids));
end;
$$;

-- Adds one variant to an active product, after its existing variants. It
-- copies its settings (unit, lot, re-order levels, cost, vendor, notes) and
-- storage areas from the product's first active variant (or, when every
-- variant is retired, its first variant), so a new size lands
-- next to the others; any of it can be edited afterwards. Returns the new
-- item's id.
create or replace function public.inventory_add_variant(
  p_product_id uuid,
  p_variant text,
  p_created_by text
)
returns uuid
language plpgsql
as $$
declare
  v_product public.inventory_products;
  v_template public.inventory_items;
  v_item_id uuid;
begin
  select * into v_product from public.inventory_products where id = p_product_id for update;
  if not found or not v_product.active then
    raise exception 'Product not found' using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(p_variant, ''))) = 0 then
    raise exception 'Name the variant' using errcode = 'P0001';
  end if;

  select * into v_template
  from public.inventory_items
  where product_id = p_product_id
  order by active desc, variant_order, name
  limit 1;

  insert into public.inventory_items (
    name, product_id, variant, variant_order, unit_id, lot_size, lot_unit_id,
    reorder_level, reorder_target, unit_cost_cents, vendor, vendor_url, notes,
    created_by
  )
  values (
    v_product.name, p_product_id, p_variant,
    coalesce((select max(variant_order) from public.inventory_items where product_id = p_product_id), 0) + 1,
    v_template.unit_id, coalesce(v_template.lot_size, 1), v_template.lot_unit_id,
    v_template.reorder_level, v_template.reorder_target, v_template.unit_cost_cents,
    v_template.vendor, v_template.vendor_url, v_template.notes,
    p_created_by
  )
  returning id into v_item_id;

  if v_template.id is not null then
    -- only the spots of an active template: a retired one's are stale
    insert into public.inventory_item_spots (item_id, area_id, sort_order)
    select v_item_id, s.area_id, s.sort_order
    from public.inventory_item_spots s
    join public.inventory_areas a on a.id = s.area_id and a.active
    where s.item_id = v_template.id and v_template.active;
  end if;

  return v_item_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

-- App access is service-role (bypasses RLS); this admin-select policy is
-- forward-looking convention, same as the other inventory tables.
alter table public.inventory_units enable row level security;

create policy "admins can select inventory units"
  on public.inventory_units for select to authenticated using (public.is_admin());
