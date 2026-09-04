-- Duty assignment: which parts of a shift a person is responsible for.
--
-- shift_assignments.role stays what it always was — the *hours* someone works
-- (full window, the setup span, or a hand-entered partial). Duties are the
-- orthogonal question the board couldn't answer: within those hours, who runs
-- set-up, who hosts, who does customer care, and who takes which half of the
-- break down. One person can hold several (Full hours, Setup + Host + Break
-- Down (A)), and a shift can leave them all unset — duties are advisory, like
-- the availability and shift-lead rules.
--
-- The vocabulary is the SOP library's, so every duty deep-links to the doc
-- that defines it (see the sops seeds): full-setup, host-responsibilities,
-- customer-care-responsibilities, break-down, break-down-a-fire-and-water,
-- break-down-b-guest-areas. Element order is normalised by the app (setup ->
-- session -> breakdown); Postgres can't dedupe an array in a check, so the
-- app layer does that too.

alter table public.shift_assignments
  add column duties text[] not null default '{}'
  check (
    duties <@ array[
      'setup',
      'host',
      'customer_care',
      'breakdown',
      'breakdown_a',
      'breakdown_b'
    ]::text[]
  );

-- Sub requests snapshot the assignment they're covering (see the sub_requests
-- migration) so a claim can recreate it — the duties have to travel with the
-- window and role, or the claimer picks up the hours without the jobs.
alter table public.sub_requests
  add column duties text[] not null default '{}'
  check (
    duties <@ array[
      'setup',
      'host',
      'customer_care',
      'breakdown',
      'breakdown_a',
      'breakdown_b'
    ]::text[]
  );
