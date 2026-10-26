-- Inventory, simplified: one flat list.
--
-- The first inventory (20261002213246_inventory.sql and the eight migrations
-- after it) modelled storage areas, spots, a stock ledger, count rounds with
-- review, orders, deliveries, rejects, products with variants, and a units
-- list. It was more than the studio needed day to day. /admin/inventory is
-- now one spreadsheet-style table, and each row carries everything about an
-- item:
--
--   * name, cost per unit, vendor, and how to order it (a link or written
--     instructions — one field, the page shows a URL as a link)
--   * how often it should be counted, and when and by whom it last was
--     ("due for a count" is worked out from those three, not stored)
--   * how many are in stock, and the level to re-order at
--
-- Setting the in-stock number *is* a count: the app stamps last_counted_at
-- and last_counted_by on every change to it. Last write wins, which is right
-- for a count — the newest look at the shelf is the truth.
--
-- Existing items are copied across (active ones only): stock is their total
-- over every spot, and the last count is their newest count line. The old
-- inventory_* tables are left in place, unused, so nothing is lost; a later
-- migration can drop them once the new list has been checked.

create table public.inventory (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  -- cost of one unit, in cents
  unit_cost_cents integer check (unit_cost_cents >= 0),
  vendor text check (char_length(vendor) <= 120),
  -- a URL to order from, or instructions ("call Dan at 555-0100, ask for the
  -- 12-pack"); the page links it when it is a URL
  how_to_order text check (char_length(how_to_order) <= 2000),
  -- count at least every this many studio days (1 = daily); null = no schedule
  count_every_days integer check (count_every_days between 1 and 365),
  -- stamped by the app whenever in_stock is set
  last_counted_at timestamptz,
  last_counted_by text,
  in_stock numeric not null default 0 check (in_stock >= 0 and in_stock <= 100000),
  -- re-order once in_stock is at or below this; null = never flag it
  reorder_at numeric check (reorder_at >= 0 and reorder_at <= 100000),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.inventory is
  'The /admin/inventory list: one row per item with cost, vendor, how to order, count schedule, last count, stock on hand, and re-order level. Supersedes the inventory_* tables.';
comment on column public.inventory.how_to_order is
  'A URL to order from or free-text ordering instructions.';
comment on column public.inventory.count_every_days is
  'Count at least every this many studio days (1 = daily); null = no schedule. Due-ness is computed in the app (lib/inventory/rules.ts).';

-- Names are unique, ignoring case and surrounding spaces.
create unique index inventory_name_idx on public.inventory (lower(btrim(name)));

create trigger inventory_set_updated_at
  before update on public.inventory
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Copy the existing items
-- ---------------------------------------------------------------------------

insert into public.inventory (
  name,
  unit_cost_cents,
  vendor,
  how_to_order,
  count_every_days,
  last_counted_at,
  last_counted_by,
  in_stock,
  reorder_at,
  created_by,
  created_at
)
select
  i.name,
  i.unit_cost_cents,
  nullif(btrim(i.vendor), ''),
  -- the order link, then any notes on the line below it
  left(nullif(btrim(concat_ws(e'\n', nullif(btrim(i.vendor_url), ''), nullif(btrim(i.notes), ''))), ''), 2000),
  i.count_every_days,
  last_count.counted_at,
  last_count.counted_by,
  least(greatest(coalesce(stock.total, 0), 0), 100000),
  least(i.reorder_level, 100000),
  i.created_by,
  i.created_at
from public.inventory_items i
left join (
  select item_id, sum(quantity) as total
  from public.inventory_stock
  group by item_id
) stock on stock.item_id = i.id
left join (
  select distinct on (item_id) item_id, counted_at, counted_by
  from public.inventory_count_lines
  order by item_id, counted_at desc
) last_count on last_count.item_id = i.id
where i.active;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

-- App access is service-role (bypasses RLS), gated in-route by the
-- /admin/inventory page grant (counts) and requireAdmin (everything else);
-- these policies are the forward-looking convention, same as the other
-- admin tables.
alter table public.inventory enable row level security;

create policy "admins can select inventory"
  on public.inventory for select
  using (public.is_admin());

create policy "admins can insert inventory"
  on public.inventory for insert
  with check (public.is_admin());

create policy "admins can update inventory"
  on public.inventory for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins can delete inventory"
  on public.inventory for delete
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- The old tables
-- ---------------------------------------------------------------------------

comment on table public.inventory_items is
  'Superseded by public.inventory (20261026192124_inventory_simple_list.sql); kept unused until the new list is confirmed.';
comment on table public.inventory_movements is
  'Superseded by public.inventory (20261026192124_inventory_simple_list.sql); kept unused until the new list is confirmed.';
