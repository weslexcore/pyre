-- Shift requests carry the role the employee is offering to work: the whole
-- shift ('full') or just the setup span ('setup', the window's first 2h).
-- The deciding manager sees the ask as it was made, and approval creates the
-- shift_assignments row with that role and the matching window instead of
-- always assigning the full shift.

-- Existing pending requests were all implicitly full-shift asks, so the
-- default backfills them correctly.
alter table public.shift_requests
  add column role text not null default 'full' check (role in ('full', 'setup'));
