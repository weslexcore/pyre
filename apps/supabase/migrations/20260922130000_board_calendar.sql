-- Boards on a calendar.
--
-- A rental lead already carries the two facts a calendar needs — a requested
-- date and a requested time — but they live in board_cards.properties under
-- keys only that board knows, so nothing could draw them on a month grid.
-- And a card routinely holds two dates that mean different things: the lead
-- above is chased two weeks before the rental (due_date) and happens on the
-- day itself (requested_date). Seeing one has never meant seeing the other.
--
-- So a board now says which of its date fields are events, and which time
-- field goes with each one. "6:00–9:00 PM Rental — Sarah's birthday" is
-- assembled from the board's own definition, and no code knows the word
-- "rentals".
--
--   * board_fields.show_on_calendar  — this date field is an event.
--   * board_fields.calendar_time_key — the field on the same board that says
--                                      when, on that date. Null is all-day.
--   * boards.due_on_calendar         — whether card due dates show too. On by
--                                      default, because a due date is the one
--                                      date every board already has.
--
-- Nothing here is per-card: the board decides once, the way show_on_card
-- already does, so nobody re-answers the same question on every card.

begin;

alter table public.board_fields
  add column show_on_calendar boolean not null default false,
  -- A key on *this* board naming a `time` or `time_range` field. A check
  -- sees one row at a time, so all it can say is "shaped like a key, and not
  -- this field itself". That the key names a live time field on the same
  -- board is checked where the whole field list is known — parseFields in
  -- lib/boards/validate.ts, with a sweep in api/admin/boards.ts for the
  -- half-cases a single request cannot see. A composite foreign key against
  -- (board_id, key) would be legal and is deliberately not used: it still
  -- could not check the *kind*, and it would turn "somebody archived the
  -- time field" into a failed write rather than a quiet fall back to an
  -- all-day entry, which is what lib/boards/calendar.ts does with a pointer
  -- it cannot follow.
  add column calendar_time_key text
    check (
      calendar_time_key is null
      or (calendar_time_key ~ '^[a-z][a-z0-9_]{1,39}$' and calendar_time_key <> key)
    );

comment on column public.board_fields.show_on_calendar is
  'Only meaningful for kind = date: this answer is an entry on the boards calendar.';
comment on column public.board_fields.calendar_time_key is
  'board_fields.key of a time/time_range field on the same board that times this date. Null means an all-day entry.';

-- The calendar's per-board read: which fields are events at all. Partial,
-- because most fields never are.
create index board_fields_calendar_idx
  on public.board_fields (board_id)
  where show_on_calendar;

alter table public.boards
  add column due_on_calendar boolean not null default true;

comment on column public.boards.due_on_calendar is
  'Whether cards on this board put their due_date on the calendar as an all-day entry. On by default; off for a pipeline where a follow-up date is noise beside the bookings themselves.';

-- The seeded rental pipeline is the case this was built for: the requested
-- date is the event, timed by the requested time.
update public.board_fields f
   set show_on_calendar = true,
       calendar_time_key = 'requested_time'
  from public.boards b
 where f.board_id = b.id
   and b.slug = 'rentals'
   and f.key = 'requested_date';

commit;
