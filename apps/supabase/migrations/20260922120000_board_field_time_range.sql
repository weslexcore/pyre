-- A board field kind for a window rather than a moment: a rental that runs
-- 6:00–9:00 PM, a setup crew's arrival slot. Stored on the card as a
-- two-element ['HH:MM', 'HH:MM'] array, venue-local like `time`.
begin;

alter table public.board_fields
  drop constraint board_fields_kind_check;
alter table public.board_fields
  add constraint board_fields_kind_check
  check (kind in ('text', 'number', 'yes_no', 'choice', 'multi_choice', 'date', 'time', 'time_range'));

commit;
