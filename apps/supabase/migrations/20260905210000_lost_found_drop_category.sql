-- Lost & found no longer categorises items.
--
-- "Black water bottle" is already the category and the description, in the
-- words a guest would use to recognise it. Picking "Water bottle" from a grid
-- straight after typing it told us nothing the title didn't, and the guest
-- email read "Black water bottle (Water bottle)" whenever the two didn't
-- overlap. The list search reads titles; the photo does the recognising.
--
-- Dropping the column takes its check constraint with it. Values recorded
-- before this remain in the `created` event detail for older items.

alter table public.lost_found_items
  drop column if exists category;
