-- On the floor: a guest moved to a longer or shorter session keeps their
-- arrival time.
--
-- To change a guest's length mid-visit, staff cancel their booking in
-- Momence and book them into the longer or shorter session, so Momence
-- charges the right price. The new booking's own check-in would restart the
-- guest's clock. Instead, /admin/guests/floor spots the move (same member, a
-- checked-in booking cancelled around when the new one was made) and writes
-- the new booking's row with the original arrival time and the check-ins
-- already marked done (lib/guests/floor.ts findMoves).
--
-- These two columns say where that row came from, so the page can show
-- "Moved from ..." and the move is carried over only once.

alter table public.guest_floor_checkins
  add column moved_from_booking_id text check (moved_from_booking_id ~ '^\d{1,20}$'),
  add column moved_from_session_id text check (moved_from_session_id ~ '^\d{1,20}$');

comment on column public.guest_floor_checkins.moved_from_booking_id is
  'The cancelled Momence booking this guest moved from; their arrival time and done check-ins were carried over from it. Null = not a move.';
comment on column public.guest_floor_checkins.moved_from_session_id is
  'The session of moved_from_booking_id, for showing "Moved from ...".';
