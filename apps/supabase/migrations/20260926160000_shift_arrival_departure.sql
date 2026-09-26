-- Shift hours without roles, and when staff arrive and leave as settings.
--
-- 1. Full / Setup / Partial go away. A person on a shift is on for the hours
--    they're on (shift_assignments.starts_at / ends_at, which already hold
--    them); the role only labelled those hours, and the duties
--    (shift_assignments.duties) now say what they do within them. The same
--    column comes off the two tables that snapshot an assignment: shift
--    requests (the requested hours are their own columns) and sub requests.
--
-- 2. How long before the first session staff arrive, and how long after the
--    last session they leave, become schedule settings (the board's ⚙
--    Settings panel) instead of a fixed 90 / 30 minutes. They are read when
--    someone is added to a shift and set that person's default hours only —
--    changing them never moves hours already on the calendar.
--
-- 3. To count from the sessions rather than the padded window, Momence
--    shifts record the first session's start and the last session's end.
--    The hourly sync fills them in (for already-synced shifts on its next
--    run); until then, and on manual shifts, the default is the shift window.

-- 1. Roles --------------------------------------------------------------

alter table public.shift_assignments drop column role;
alter table public.sub_requests drop column role;
alter table public.shift_requests drop column role;

-- 2. Arrive-before / leave-after settings ----------------------------------

-- schedule_settings held on/off switches only; the two new rows are minute
-- counts. Each row holds exactly one of the two kinds of value.
alter table public.schedule_settings
  alter column enabled drop not null,
  add column minutes integer check (minutes between 0 and 240),
  add constraint schedule_settings_one_value_check
    check ((enabled is null) <> (minutes is null));

comment on column public.schedule_settings.minutes is
  'Minute-count settings (arrive_before_min, leave_after_min); null for the on/off switches, which use enabled.';

-- Today's fixed values, so nothing changes until an admin changes them.
insert into public.schedule_settings (key, minutes) values
  ('arrive_before_min', 90),
  ('leave_after_min', 30)
on conflict (key) do nothing;

-- 3. Session edges on shifts -------------------------------------------------

alter table public.shifts
  add column sessions_start_at time,
  add column sessions_end_at time;

comment on column public.shifts.sessions_start_at is
  'Momence shifts: start of the first session the window opens for. Null on manual shifts, on the second half of a split long day, and until the sync records it. New assignments default to this minus the arrive_before_min setting.';
comment on column public.shifts.sessions_end_at is
  'Momence shifts: end of the last session the window closes after. Null on manual shifts, on the first half of a split long day, and until the sync records it. New assignments default to this plus the leave_after_min setting.';
