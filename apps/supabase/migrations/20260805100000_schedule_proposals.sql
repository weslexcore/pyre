-- AI schedule proposals: the pyre-agents scheduler drafts a week (extra
-- shifts + assignments) as a batch the admin reviews on /admin/schedule —
-- approve the week, accept/reject items, or discard. Also adds sync_flag so
-- the Momence sync-shifts job can flag shifts whose underlying sessions were
-- cancelled or moved instead of silently changing staffed work. See
-- apps/integrations/docs/staff-scheduling-scope.md.

-- One row per agent draft batch for one Monday-start week.
create table public.schedule_proposals (
  id uuid primary key default gen_random_uuid(),
  -- Monday of the drafted week (matches weekStartOf in schedule-core)
  week_start date not null,
  -- draft = awaiting review; approved = batch accepted (items flipped live);
  -- superseded = replaced by a newer draft for the same week;
  -- discarded = rejected wholesale
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'superseded', 'discarded')),
  -- the agent's markdown summary shown on the board (per-day bullets, tradeoffs)
  rationale text,
  -- machine-readable extras: counts, warnings, per-day notes
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  source text not null check (source in ('cron', 'manual')),
  -- Eve session id, for tracing a draft back to its agent run
  agent_session_id text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index schedule_proposals_week_idx on public.schedule_proposals (week_start, status);

-- Draft linkage on the schedule tables. is_draft rows belong to an open
-- proposal and are excluded from every read that isn't the review UI;
-- approving flips is_draft off and keeps proposal_id for provenance.
-- A draft assignment may reference a LIVE shift (the agent staffing an
-- existing window), so is_draft lives on both tables independently.
alter table public.shifts
  add column proposal_id uuid references public.schedule_proposals (id) on delete cascade,
  add column is_draft boolean not null default false,
  -- set by sync-shifts when Momence diverges from a shift it can't silently
  -- fix: sessions_cancelled = underlying sessions gone/cancelled but people
  -- are assigned (or the shift is sync_locked); times_changed = session times
  -- moved under a sync_locked shift. Cleared on admin edit or resolution.
  add column sync_flag text
    check (sync_flag in ('sessions_cancelled', 'times_changed'));

alter table public.shift_assignments
  add column proposal_id uuid references public.schedule_proposals (id) on delete cascade,
  add column is_draft boolean not null default false;

create index shifts_draft_idx on public.shifts (proposal_id) where is_draft;
create index shift_assignments_draft_idx on public.shift_assignments (proposal_id) where is_draft;

alter table public.schedule_proposals enable row level security;

create policy "admins can select schedule proposals"
  on public.schedule_proposals for select to authenticated using (public.is_admin());

create trigger schedule_proposals_set_updated_at
  before update on public.schedule_proposals
  for each row execute function public.set_updated_at();
