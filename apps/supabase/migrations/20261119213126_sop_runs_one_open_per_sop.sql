-- One open (in_progress) checklist run per SOP.
--
-- POST /api/admin/sop-runs starts a run by reading "is one open?" and then
-- inserting when none is. Two people tapping the first item of the same
-- checklist at the same moment both read "none" and both insert, so the
-- checklist splits into parallel runs, each with half the ticks, and neither
-- completes. The rule was always one open run per document (people working a
-- checklist together share it); this index makes the database hold it. The
-- endpoint treats a unique violation on insert as "someone else just started
-- it" and joins that run instead.
--
-- Runs already split that way are settled first: per SOP the newest open run
-- stays open and every older one is closed as abandoned, the same way the
-- hourly sweep closes a run left open (ended_by null = closed by the system).
-- Their checks stay on them, so the run log keeps what was done.

with ranked as (
  select
    id,
    row_number() over (partition by sop_id order by started_at desc, id desc) as rank
  from public.sop_runs
  where status = 'in_progress'
)
update public.sop_runs
set status = 'abandoned',
    ended_by = null,
    ended_at = now()
where id in (select id from ranked where rank > 1);

create unique index sop_runs_one_open_per_sop
  on public.sop_runs (sop_id)
  where status = 'in_progress';

comment on index public.sop_runs_one_open_per_sop is
  'At most one in_progress run per SOP: concurrent starts join the run that won (POST /api/admin/sop-runs).';
