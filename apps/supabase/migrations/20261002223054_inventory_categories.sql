-- Inventory categories become a configured list.
--
-- 20261002213246_inventory.sql gave inventory_items a free-text `category`,
-- which let "Cleaning" and "cleaning supplies" both exist and made per-
-- category reports unreliable. Categories are now rows admins manage on
-- /admin/inventory/setup (name, display order, retire/restore), and the
-- item form picks one from a drop-down.
--
-- Steps:
--   1. create inventory_categories;
--   2. turn every distinct existing text category into a row (matched
--      case-insensitively, so "Linens" and "linens " become one category);
--   3. point each item at its row through the new category_id;
--   4. drop the text column.

-- ---------------------------------------------------------------------------
-- 1. The list
-- ---------------------------------------------------------------------------

create table public.inventory_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 60),
  -- display order in the drop-down and the setup list (ascending)
  sort_order integer not null default 0,
  -- retired categories stay on the items that have them but are no longer
  -- offered for new choices
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Two active categories with the same name would make the drop-down ambiguous.
create unique index inventory_categories_active_name_idx
  on public.inventory_categories (lower(btrim(name)))
  where active;

create trigger inventory_categories_set_updated_at
  before update on public.inventory_categories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Carry over the categories already typed onto items
-- ---------------------------------------------------------------------------

-- One row per distinct name (case- and space-insensitive), spelled the way it
-- was first entered, ordered alphabetically.
insert into public.inventory_categories (name, sort_order, created_by)
select name, row_number() over (order by lower(name)), 'migration'
from (
  select distinct on (lower(btrim(category))) btrim(category) as name
  from public.inventory_items
  where length(btrim(coalesce(category, ''))) > 0
  order by lower(btrim(category)), created_at
) existing;

-- ---------------------------------------------------------------------------
-- 3. Items reference a category by id
-- ---------------------------------------------------------------------------

alter table public.inventory_items
  add column category_id uuid references public.inventory_categories (id) on delete restrict;

comment on column public.inventory_items.category_id is
  'Grouping for the setup list and reports, from inventory_categories; null = uncategorised.';

update public.inventory_items i
set category_id = c.id
from public.inventory_categories c
where lower(btrim(i.category)) = lower(c.name);

create index inventory_items_category_idx on public.inventory_items (category_id);

-- ---------------------------------------------------------------------------
-- 4. Retire the free-text column
-- ---------------------------------------------------------------------------

alter table public.inventory_items drop column category;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

-- App access is service-role (bypasses RLS); this admin-select policy is
-- forward-looking convention, same as the other inventory tables.
alter table public.inventory_categories enable row level security;

create policy "admins can select inventory categories"
  on public.inventory_categories for select to authenticated using (public.is_admin());
