-- A category on each inventory item ("Cleaning", "Linens"), so the list can
-- be filtered by it.
--
-- Plain text, not a lookup table: the list's drop-down offers every category
-- already in use plus "Add new category", so a category exists exactly as
-- long as some item has it. Grouping is case-sensitive as typed; the app
-- trims it.
--
-- Backfilled from the old inventory_categories via the item each row was
-- copied from (matched by name, as in 20261026192947).

alter table public.inventory
  add column category text check (char_length(category) between 1 and 60);

comment on column public.inventory.category is
  'Free-text grouping for filtering /admin/inventory; null = uncategorised. The drop-down offers the distinct values in use.';

update public.inventory inv
set category = left(btrim(c.name), 60)
from public.inventory_items old
join public.inventory_categories c on c.id = old.category_id
where old.active
  and lower(btrim(old.name)) = lower(btrim(inv.name))
  and inv.category is null
  and btrim(c.name) <> '';
