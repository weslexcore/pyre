-- Inventory variants: one product that comes in several sizes, colours, or
-- flavours ("Pyre Tee" in S / M / L / XL, "Sparkling water" in Lemon / Lime).
--
-- Each variant is still an ordinary inventory_items row, because everything
-- the inventory tracks is per variant: a medium runs out on its own, so it
-- has its own stock per spot, re-order level, cost, counts, orders, and
-- rejects. What's new is the grouping:
--
--   * `inventory_products` — the product the variants belong to: its name
--                            and category.
--   * `inventory_items.product_id` / `variant` / `variant_order` — which
--                            product an item is a variant of, its label
--                            ("M", "Lemon"), and where it sorts among its
--                            siblings (S before M before L — not
--                            alphabetical).
--
-- A variant's `name` is kept as "<product> — <variant>" and its category as
-- the product's by triggers, so every screen and report that shows an item
-- name or groups by category keeps working without knowing about products.
-- Items with no product (towels, soap) are unchanged.
--
-- `inventory_create_product` adds a product with all its variants (and the
-- storage areas they're kept in) in one transaction; `inventory_add_variant`
-- adds one more variant to an existing product, copying its siblings'
-- settings and spots.

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------

create table public.inventory_products (
  id uuid primary key default gen_random_uuid(),
  -- 60 + " — " + a 40-character variant stays inside the item name's 120
  name text not null check (length(btrim(name)) between 1 and 60),
  category_id uuid references public.inventory_categories (id) on delete restrict,
  -- retiring a product retires every variant; restoring it leaves each
  -- variant to be restored on its own
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index inventory_products_active_name_idx
  on public.inventory_products (lower(btrim(name)))
  where active;

create index inventory_products_category_idx on public.inventory_products (category_id);

create trigger inventory_products_set_updated_at
  before update on public.inventory_products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Items as variants
-- ---------------------------------------------------------------------------

alter table public.inventory_items
  add column product_id uuid references public.inventory_products (id) on delete restrict,
  -- "M", "Black", "Lemon"
  add column variant text check (length(btrim(variant)) between 1 and 40),
  -- position among the product's variants (ascending)
  add column variant_order integer not null default 0,
  add constraint inventory_items_product_variant_check check ((product_id is null) = (variant is null));

comment on column public.inventory_items.product_id is
  'The product this item is a variant of (inventory_products); null for a standalone item. A variant''s name and category are kept in step with its product by triggers.';
comment on column public.inventory_items.variant is
  'The variant''s label within its product ("M", "Lemon"); set exactly when product_id is.';

-- Two active variants of one product with the same label would be ambiguous.
create unique index inventory_items_active_variant_idx
  on public.inventory_items (product_id, lower(btrim(variant)))
  where active and product_id is not null;

create index inventory_items_product_idx
  on public.inventory_items (product_id, variant_order)
  where product_id is not null;

-- A variant's name and category come from its product, and it can't be
-- active while its product is retired.
create or replace function public.inventory_items_sync_variant()
returns trigger
language plpgsql
as $$
declare
  v_product public.inventory_products;
begin
  if new.product_id is null then
    return new;
  end if;
  select * into v_product from public.inventory_products where id = new.product_id;
  if not found then
    raise exception 'Product not found' using errcode = 'P0001';
  end if;
  if new.active and not v_product.active then
    raise exception 'Restore % first', v_product.name using errcode = 'P0001';
  end if;
  new.variant := btrim(new.variant);
  new.name := btrim(v_product.name) || ' — ' || new.variant;
  new.category_id := v_product.category_id;
  return new;
end;
$$;

create trigger inventory_items_sync_variant
  before insert or update on public.inventory_items
  for each row execute function public.inventory_items_sync_variant();

-- Renaming, re-categorising, or retiring a product carries to its variants
-- (the item trigger above recomputes their names and categories).
create or replace function public.inventory_products_cascade()
returns trigger
language plpgsql
as $$
begin
  if new.name is distinct from old.name or new.category_id is distinct from old.category_id then
    update public.inventory_items
    set updated_at = now()
    where product_id = new.id;
  end if;
  if old.active and not new.active then
    update public.inventory_items
    set active = false
    where product_id = new.id and active;
  end if;
  return new;
end;
$$;

create trigger inventory_products_cascade
  after update on public.inventory_products
  for each row execute function public.inventory_products_cascade();

-- ---------------------------------------------------------------------------
-- Creating a product with its variants
-- ---------------------------------------------------------------------------

-- Adds a product and one item per label in p_variants (in that order), each
-- with the shared settings in p_item (the inventory_items columns the item
-- form sets: unit, lot_size, lot_label, reorder_level, reorder_target,
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
      name, product_id, variant, variant_order, unit, lot_size, lot_label,
      reorder_level, reorder_target, unit_cost_cents, vendor, vendor_url, notes,
      created_by
    )
    values (
      -- recomputed by inventory_items_sync_variant
      btrim(p_name), v_product_id, v_variant, v_order,
      coalesce(p_item ->> 'unit', 'each'),
      coalesce((p_item ->> 'lot_size')::numeric, 1),
      p_item ->> 'lot_label',
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
-- storage areas from the product's first active variant, so a new size lands
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
  where product_id = p_product_id and active
  order by variant_order, name
  limit 1;

  insert into public.inventory_items (
    name, product_id, variant, variant_order, unit, lot_size, lot_label,
    reorder_level, reorder_target, unit_cost_cents, vendor, vendor_url, notes,
    created_by
  )
  values (
    v_product.name, p_product_id, p_variant,
    coalesce((select max(variant_order) from public.inventory_items where product_id = p_product_id), 0) + 1,
    coalesce(v_template.unit, 'each'), coalesce(v_template.lot_size, 1), v_template.lot_label,
    v_template.reorder_level, v_template.reorder_target, v_template.unit_cost_cents,
    v_template.vendor, v_template.vendor_url, v_template.notes,
    p_created_by
  )
  returning id into v_item_id;

  if v_template.id is not null then
    insert into public.inventory_item_spots (item_id, area_id, sort_order)
    select v_item_id, s.area_id, s.sort_order
    from public.inventory_item_spots s
    join public.inventory_areas a on a.id = s.area_id and a.active
    where s.item_id = v_template.id;
  end if;

  return v_item_id;
end;
$$;

-- Only the app's service role calls these; they trust p_created_by.
revoke all on function public.inventory_create_product(text, uuid, text[], jsonb, uuid[], text)
  from public, anon, authenticated;
revoke all on function public.inventory_add_variant(uuid, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

-- App access is service-role (bypasses RLS); this admin-select policy is
-- forward-looking convention, same as the other inventory tables.
alter table public.inventory_products enable row level security;

create policy "admins can select inventory products"
  on public.inventory_products for select to authenticated using (public.is_admin());

comment on table public.inventory_products is
  'A product that comes in variants (sizes, colours, flavours). Each variant is an inventory_items row with product_id set; its name and category follow the product.';
