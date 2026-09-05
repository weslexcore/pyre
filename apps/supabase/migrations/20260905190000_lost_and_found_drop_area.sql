-- Lost & found no longer records where an item was picked up.
--
-- The column came over from the incident taxonomy, where where-it-happened is
-- the point of the report. For a bottle in the bin it answered nothing: staff
-- need to know where it is now (storage_location), and the guest reading "Did
-- you leave this behind?" recognises the photo, not the words "Changing area".
-- Asking for it was a tap on every log for a field nobody read.
--
-- Rows already logged keep their value in the `created` event detail, so the
-- audit trail of what was recorded at the time stays intact.

alter table public.lost_found_items
  drop column if exists area;
