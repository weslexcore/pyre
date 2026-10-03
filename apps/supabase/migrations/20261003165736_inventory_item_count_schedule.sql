-- Per-item count schedule.
--
-- Until now only storage areas had a count schedule
-- (inventory_areas.count_every_days). Some items need checking more often
-- than the shelf they sit on — propane daily, hair ties weekly — so an item
-- can now carry its own minimum count frequency. It is a reminder only: the
-- Count tab lists items whose time has come; nothing is blocked or forced.
--
-- An item is due once that many studio days have passed since every spot it
-- lives in was last counted (1 = daily: due again each new day). Items
-- without their own schedule just follow their areas', as before.

alter table public.inventory_items
  add column count_every_days integer check (count_every_days between 1 and 365);

comment on column public.inventory_items.count_every_days is
  'Minimum count frequency for this item in studio days (1 = daily); null = follow its storage areas'' schedules. Drives the "Items to count" list on the Count tab.';

-- "When was this item last counted in this spot" for the due list.
create index inventory_count_lines_item_idx
  on public.inventory_count_lines (item_id, area_id, counted_at desc);
