-- The checklist-run log becomes a shared record. It started as an admin
-- report: 20260820220000_sop_runs.sql says "/admin/sops/runs gives admins the
-- full record", and everyone else saw only the runs they had personally taken
-- part in — started, ended, or checked an item in.
--
-- That defeated the point of the log for the people who actually run the
-- checklists. Staff open it to see who has completed what: whether opening was
-- done this morning, who ticked the last item at close, who is mid-run now. So
-- reading widens:
--
--   1. Everyone who can reach /admin/sops reads the log, with the same filters
--      admins have (status, SOP, person, date, checked-item text).
--   2. Reading is still bounded by the document. A run's checks quote the SOP's
--      own task items, so a run is readable by exactly the people who may read
--      the SOP it ran — the same per-document grants the library uses
--      (view_roles/edit_roles/view_emails/edit_emails, see lib/sops/levels).
--      Admins read every run, archived documents included.
--   3. Deleting a run still erases an accountability record, so it stays
--      admin-only.
--
-- The app reads these tables with the service role, so this migration carries
-- no functional change — it updates the table comments that document the
-- access model, so the schema stops describing the old admins-only contract.
-- The RLS policies stay admin-only: they are the forward-looking convention the
-- other sops tables follow, and the run log has no per-row owner to key them on
-- (visibility lives on the parent document, not the run).

comment on table public.sop_runs is
  'One execution of a checklist SOP: who started/ended it, when, against which document version. Checked items live in sop_run_checks. The log (/admin/sops/runs) is shared: anyone who may view the SOP may read its runs; only admins may delete one.';
comment on table public.sop_run_checks is
  'One checked task item within a run: which item (by snapshot position and text), who checked it, when. Unchecking deletes the row. Readable by whoever may view the SOP the run belongs to.';
