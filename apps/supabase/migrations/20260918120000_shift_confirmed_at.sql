-- Manual "set in stone" override for shifts.
--
-- Until now a shift was tentative purely by date: every Monday the schedule
-- locks the week that just started plus the next (packages/schedule-core
-- horizon.ts), and anything beyond that Monday-after-next boundary rendered
-- as "≈ tentative". Admins need to promise a shift earlier than that — a
-- special event booked a month out, a week they've already settled with the
-- crew — so a shift can now be confirmed by hand.
--
-- confirmed_at null means "follow the date rule". Set, the shift reads as
-- confirmed on the board and calendar however far out it is. Clearing it
-- returns the shift to the date rule (it does not force a shift inside the
-- locked window back to tentative). Who confirmed it goes in
-- schedule_changes like every other shift edit, so no confirmed_by column.

alter table public.shifts
  add column confirmed_at timestamptz;

comment on column public.shifts.confirmed_at is
  'Admin marked this shift set in stone ahead of the two-week horizon; null follows the date rule.';
