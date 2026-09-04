-- Correct the record: the setup_duty_halves migration's header describes the
-- A/B pairing backwards. The rule is that a person KEEPS their letter across
-- both phases — whoever takes Set Up (A) takes Break Down (A) — because the
-- person who lit the fire and balanced the water is the one who knows that
-- side's state at close. Comments only; the pairing has always been advice
-- the board and the scheduler prompt give, never a database constraint.

comment on column public.shift_assignments.duties is
  'Jobs held within the assignment''s hours, orthogonal to role (which is the '
  'hours). Set-up and break down each split into an (A) fire-and-water half '
  'and a (B) space/guest-areas half; a person keeps their letter across both '
  'phases, and someone working a shift alone holds both. Ordering and dedupe '
  'are the app''s job — see ASSIGNMENT_DUTIES in @pyre/schedule-core.';

comment on column public.sub_requests.duties is
  'The covered assignment''s duties, snapshotted at request time so a claim '
  'can recreate them. Same vocabulary as shift_assignments.duties.';
