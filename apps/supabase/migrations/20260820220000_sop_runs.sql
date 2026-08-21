-- Checklist runs: a staff member "starts" an SOP that contains task items
-- (the setup/breakdown checklists), checks items off as they work, and
-- "finishes" when done. One sop_runs row per execution — who started and
-- ended it and when — plus one sop_run_checks row per item checked, recording
-- who checked it and when. /admin/sops/runs gives admins the full record.
--
-- Runs pin the document version current at start (sop_version): item indexes
-- refer to the task list of that snapshot, so a document edit mid-run can't
-- shift what an existing check means.

create table public.sop_runs (
  id uuid primary key default gen_random_uuid(),
  sop_id uuid not null references public.sops (id) on delete cascade,
  -- The sops.current_version when the run started; the run renders from the
  -- matching sop_versions snapshot.
  sop_version integer not null check (sop_version >= 1),
  -- Number of task items in that snapshot; denormalized for progress math.
  task_count integer not null check (task_count >= 1),
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'abandoned')),
  -- Emails from the session, never the request body.
  started_by text not null,
  started_at timestamptz not null default now(),
  ended_by text,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger sop_runs_set_updated_at
  before update on public.sop_runs
  for each row execute function public.set_updated_at();

-- The admin board lists newest-first, filtered by status; the document page
-- looks up the in-progress run for one SOP.
create index sop_runs_started_idx on public.sop_runs (started_at desc);
create index sop_runs_sop_status_idx on public.sop_runs (sop_id, status);

create table public.sop_run_checks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.sop_runs (id) on delete cascade,
  -- Position of the task in the run's document snapshot (0-based, document
  -- order). The unique constraint also makes concurrent double-checks safe.
  item_index integer not null check (item_index >= 0),
  -- The task's text at check time, so the admin record reads on its own.
  item_text text not null,
  checked_by text not null,
  checked_at timestamptz not null default now(),
  unique (run_id, item_index)
);

create index sop_run_checks_run_idx on public.sop_run_checks (run_id, item_index);

alter table public.sop_runs enable row level security;
alter table public.sop_run_checks enable row level security;

-- App access is service-role (bypasses RLS); forward-looking convention like
-- the other sops tables.
create policy "admins can select sop runs"
  on public.sop_runs for select
  using (public.is_admin());

create policy "admins can insert sop runs"
  on public.sop_runs for insert
  with check (public.is_admin());

create policy "admins can update sop runs"
  on public.sop_runs for update
  using (public.is_admin());

create policy "admins can select sop run checks"
  on public.sop_run_checks for select
  using (public.is_admin());

create policy "admins can insert sop run checks"
  on public.sop_run_checks for insert
  with check (public.is_admin());

create policy "admins can delete sop run checks"
  on public.sop_run_checks for delete
  using (public.is_admin());

comment on table public.sop_runs is
  'One execution of a checklist SOP: who started/ended it, when, against which document version. Checked items live in sop_run_checks.';
comment on table public.sop_run_checks is
  'One checked task item within a run: which item (by snapshot position and text), who checked it, when. Unchecking deletes the row.';
