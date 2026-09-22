-- Keep existing requested dates intact; leads may have a date before a time
-- is agreed. Store the requested time as venue-local HH:MM, not a UTC instant.
begin;

alter table public.board_fields
  drop constraint board_fields_kind_check;
alter table public.board_fields
  add constraint board_fields_kind_check
  check (kind in ('text', 'number', 'yes_no', 'choice', 'multi_choice', 'date', 'time'));

insert into public.board_fields
  (board_id, key, label, kind, options, hint, show_on_card, sort_order)
select id, 'requested_time', 'Requested time', 'time', '{}'::text[],
  'Eastern Time (America/New_York). Leave blank until a time is agreed.', true, 45
from public.boards
where slug = 'rentals'
on conflict (board_id, key) do nothing;

commit;
