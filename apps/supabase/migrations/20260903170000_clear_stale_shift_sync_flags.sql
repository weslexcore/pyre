-- Clear divergence flags left on past shifts by the Momence sync.
--
-- Until 2026-09-03 the sync fetched Momence sessions starting from the current
-- instant while reconciling every shift on the current ET date, so once a
-- day's sessions had all begun it flagged that day's staffed shift as
-- sessions_cancelled (and had already walked its start time later). The next
-- day the row left the sync range and the flag never cleared. The sync now
-- fetches from ET midnight (see packages/schedule-core syncRange), so these
-- rows are historical noise on the schedule board; nothing recomputes them.
-- Start times on those past rows are left as-is — a manual "Sync Momence"
-- with a lookback repairs recent days.

update public.shifts
set sync_flag = null
where sync_flag is not null
  and shift_date < (now() at time zone 'America/New_York')::date;
