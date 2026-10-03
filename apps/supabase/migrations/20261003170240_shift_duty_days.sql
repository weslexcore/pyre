-- Shift duties can be limited to days of the week.
--
-- Some jobs aren't every shift: the plants are watered Friday to Sunday, the
-- propane is weighed at Wednesday's set-up and Sunday's break down. A duty's
-- days decide where it is offered — the schedule board's picker on a shift
-- that day, and the scheduler agent's draft for it. Off its days a duty isn't
-- offered, but one already held stays readable (the board flags it), so
-- narrowing the days never rewrites anyone's shift.
--
-- A job done in different phases on different days is two duties, one per
-- phase (Weigh Propane in Setup on Wednesday, Weigh Propane in Breakdown on
-- Sunday): the phase still says when in the shift it happens.

alter table public.shift_duties
  add column days smallint[]
    check (
      days is null
      or (
        cardinality(days) between 1 and 6
        and days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
      )
    );

comment on column public.shift_duties.days is
  'Days of the week the duty is done, 0 = Sunday … 6 = Saturday (as time_off.days_of_week); null for every day. Normalised by the API: unique, ascending, never all seven.';
