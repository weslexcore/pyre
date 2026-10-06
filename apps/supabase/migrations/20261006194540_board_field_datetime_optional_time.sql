-- The time on a date & time answer is optional.
--
-- 20261006193221_board_field_datetime added the datetime field kind with
-- every answer a day and a time: 'YYYY-MM-DDTHH:MM'. A day whose hour nobody
-- has agreed yet had nowhere to go but a separate date field, so each answer
-- may now be a day alone as well:
--
--   * 'YYYY-MM-DDTHH:MM' — a day and a time on the bathhouse's wall clock;
--   * 'YYYY-MM-DD'       — a day with no time yet, drawn all day on the
--                          calendar;
--
-- or an array mixing both, in board_cards.properties under the field's key.
-- The shape is checked in the app (lib/boards/datetime.ts), so nothing in the
-- schema changes; this records the rule where the field kinds are described.

begin;

comment on constraint board_fields_kind_check on public.board_fields is
  'The shapes a board field can take. A datetime answer is YYYY-MM-DD or YYYY-MM-DDTHH:MM (the time is optional), or an array of either; answers are checked in the app (lib/boards).';

commit;
