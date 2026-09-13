-- Filter servicing on the cold-tub water log: staff need to record when a
-- tub's cartridge was rinsed and when it was swapped for a new one, so
-- "when was this last done?" is answerable from the same log as the readings.
--
-- Modeled as a fourth entry type rather than a flag on a test, because a
-- filter service is its own visit to the tub — like a shock or a drain/refill
-- it carries no reading panel, just what was done and any notes.

-- 1. Widen the entry-type check to admit 'filter'. The constraint kept its
--    auto-generated name from the original table, so it is dropped and
--    recreated under the same name.
alter table public.water_tests
  drop constraint water_tests_entry_type_check;

alter table public.water_tests
  add constraint water_tests_entry_type_check
    check (entry_type in ('test', 'shock', 'refill', 'filter'));

-- 2. What was done to the filter: rinsed clean and put back, or replaced with
--    a new cartridge. Null on every other entry type.
alter table public.water_tests
  add column filter_action text
    check (filter_action in ('rinsed', 'changed'));

-- A filter entry is meaningless without the action, and the action is
-- meaningless on anything else — so the two travel together in both
-- directions. Existing rows are all non-filter with a null action, so they
-- satisfy this as written.
alter table public.water_tests
  add constraint water_tests_filter_action_matches_entry_type
    check ((entry_type = 'filter') = (filter_action is not null));
