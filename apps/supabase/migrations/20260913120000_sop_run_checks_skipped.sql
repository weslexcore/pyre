-- Checklist items can now be skipped as well as completed. Until now a run's
-- record told two stories apart only by absence: an item with no
-- sop_run_checks row was either deliberately left undone or simply never
-- looked at, and the log could not say which. Finish-with-items-unchecked
-- was the only way to end a run short, and it is what produced those blanks.
--
-- Now every item is resolved one way or the other. A sop_run_checks row means
-- the item was dealt with: completed (skipped = false, the default and what
-- every existing row already is) or explicitly skipped (skipped = true), by
-- whom and when either way. A run finishes on its own the moment every item
-- has a row — completed or skipped — so a finished run never has an item
-- nobody accounted for. The explicit "complete with items unchecked" action
-- is gone from the runs API; runs from before this change that ended short
-- still render in the log with their items marked never checked.
--
-- Nothing else changes: item_index stays unique per run (a skip and a check
-- of the same item cannot coexist), unchecking a skipped item deletes the row
-- like unchecking a completed one, and the run still discards itself when
-- its last row goes.

alter table public.sop_run_checks
  add column skipped boolean not null default false;

comment on column public.sop_run_checks.skipped is
  'True when the item was explicitly skipped rather than completed. Either way the item counts as resolved for finishing the run; who and when are in checked_by / checked_at.';

comment on table public.sop_run_checks is
  'One resolved task item within a run: which item (by snapshot position and text), who resolved it, when, and whether it was completed or skipped. Un-resolving deletes the row. Readable by whoever may view the SOP the run belongs to.';

comment on table public.sop_runs is
  'One execution of a checklist SOP: who started/ended it, when, against which document version. Resolved items (completed or skipped) live in sop_run_checks; the run completes itself once every item has a row. The log (/admin/sops/runs) is shared: anyone who may view the SOP may read its runs; only admins may delete one.';
