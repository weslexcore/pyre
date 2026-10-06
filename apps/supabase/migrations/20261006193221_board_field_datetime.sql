-- One more shape a board field can take: a date & time.
--
-- A date field says which day; pairing it with a time field (calendar_time_key)
-- says when on that day — but only one time for the whole card, so a lead
-- offering three possible evenings, each at a different hour, had nowhere to
-- put the hours. A date & time field holds the day and the time together,
-- one answer or several, the way a date field already takes one or several.
-- The time is optional on each answer: a day whose hour nobody has agreed yet
-- is still written down, and shows all day on the calendar.
--
-- A card's answer lives in board_cards.properties under the field's key, like
-- every typed answer: 'YYYY-MM-DDTHH:MM' on the bathhouse's wall clock, or
-- 'YYYY-MM-DD' when there is no time, or an array of either. The shape is
-- checked in the app (lib/boards/datetime.ts).
--
-- show_on_calendar already means "draw this field's answers on the calendar";
-- it now applies to a date & time as well as a date. calendar_time_key stays
-- a date-only setting: a date & time carries its own time.

begin;

alter table public.board_fields
  drop constraint board_fields_kind_check;
alter table public.board_fields
  add constraint board_fields_kind_check
  check (kind in (
    'text', 'long_text', 'email', 'phone', 'number', 'yes_no',
    'choice', 'multi_choice', 'date', 'datetime', 'time', 'time_range', 'files',
    'card_link', 'checklist'
  ));

comment on column public.board_fields.show_on_calendar is
  'Only meaningful for kind = date or datetime: the answers are entries on the board calendar.';

commit;
