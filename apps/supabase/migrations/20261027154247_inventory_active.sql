-- Inactive inventory items: ones the studio only stocks some of the year
-- (seasonal), or has stopped stocking but wants to keep with their history.
-- An inactive item drops out of the everyday list, is never due for a count
-- or flagged for re-order, and comes back with everything intact when it is
-- marked active again. Deleting stays for mistakes.

alter table public.inventory
  add column active boolean not null default true;

comment on column public.inventory.active is
  'false = set aside (e.g. seasonal): hidden from the everyday list, never due or low. Toggled on /admin/inventory by inventory:manage.';
