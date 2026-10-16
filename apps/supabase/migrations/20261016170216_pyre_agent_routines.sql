-- Pyre Agent routines: requests a person saves for Pyre Agent (/admin/ask)
-- to run on a cadence — "every Monday at 8am, summarize last week's shift
-- notes for the team update". Each run opens a fresh Pyre Agent
-- conversation as the routine's owner, so it answers from exactly what they
-- may see today (their access is resolved at run time, not when it was
-- saved), lands in their conversation history like any other, and can be
-- followed up on there. When the answer is ready, the owner gets a
-- notification linking to it.
--
-- Times are the studio's wall clock (America/New_York) to the hour: the
-- runner is the hourly cron tick (apps/integrations lib/pyre-agent/routines),
-- so 8am means the first tick at or after 8:00 Eastern.
--
-- Access is enforced in the app (/api/admin/agent-routines: the Ask page
-- grant, and only the owner's own routines); app access is service-role, so
-- the policies below are the admin-only convention the other admin tables
-- follow.

create table public.pyre_agent_routines (
  id uuid primary key default gen_random_uuid(),
  -- Session email of the person it runs as and reports to.
  owner_email text not null check (char_length(owner_email) between 3 and 320),
  -- What the list calls it ("Weekly shift notes summary").
  title text not null check (length(btrim(title)) > 0 and char_length(title) <= 100),
  -- The request itself, sent to the agent as the question.
  prompt text not null check (length(btrim(prompt)) > 0 and char_length(prompt) <= 2000),
  -- daily: every day; weekly: on `weekdays`; monthly: on `month_day`.
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly')),
  -- 0 = Sunday … 6 = Saturday, for weekly routines.
  weekdays smallint[] not null default '{}'
    check (weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  -- 1–28 so every month has the day, for monthly routines.
  month_day smallint check (month_day is null or month_day between 1 and 28),
  -- Hour of the day it runs, Eastern.
  hour smallint not null check (hour between 0 and 23),
  enabled boolean not null default true,
  -- When it next runs (UTC instant of the next wall-clock slot); null while paused.
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pyre_agent_routines_weekly_days_check
    check (frequency <> 'weekly' or coalesce(array_length(weekdays, 1), 0) > 0),
  constraint pyre_agent_routines_monthly_day_check
    check (frequency <> 'monthly' or month_day is not null),
  constraint pyre_agent_routines_paused_check
    check (enabled = (next_run_at is not null))
);

-- The runner reads what is due.
create index pyre_agent_routines_due_idx
  on public.pyre_agent_routines (next_run_at)
  where enabled;

-- The page lists one person's routines.
create index pyre_agent_routines_owner_idx
  on public.pyre_agent_routines (owner_email, created_at);

create trigger pyre_agent_routines_set_updated_at
  before update on public.pyre_agent_routines
  for each row execute function public.set_updated_at();

-- One row per time a routine ran: the conversation it opened and how it went.
create table public.pyre_agent_routine_runs (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.pyre_agent_routines (id) on delete cascade,
  -- The slot it ran for (scheduled), or when someone pressed Run now (manual).
  scheduled_for timestamptz not null,
  trigger text not null check (trigger in ('scheduled', 'manual')),
  -- running → answered | failed. 'running' rows the agent never reports on
  -- are failed by the runner once they are stale.
  status text not null default 'running'
    check (status in ('running', 'answered', 'failed')),
  -- The Pyre Agent conversation; null when the run failed before opening one.
  session_id text check (session_id is null or char_length(session_id) <= 200),
  error text check (error is null or char_length(error) <= 1000),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint pyre_agent_routine_runs_finished_check
    check ((status = 'running') = (finished_at is null))
);

-- A slot runs at most once, however many ticks overlap it.
create unique index pyre_agent_routine_runs_slot_key
  on public.pyre_agent_routine_runs (routine_id, scheduled_for)
  where trigger = 'scheduled';

create index pyre_agent_routine_runs_routine_idx
  on public.pyre_agent_routine_runs (routine_id, started_at desc);

create index pyre_agent_routine_runs_session_idx
  on public.pyre_agent_routine_runs (session_id);

create index pyre_agent_routine_runs_running_idx
  on public.pyre_agent_routine_runs (started_at)
  where status = 'running';

alter table public.pyre_agent_routines enable row level security;
alter table public.pyre_agent_routine_runs enable row level security;

create policy "admins can select pyre agent routines"
  on public.pyre_agent_routines for select
  using (public.is_admin());

create policy "admins can insert pyre agent routines"
  on public.pyre_agent_routines for insert
  with check (public.is_admin());

create policy "admins can update pyre agent routines"
  on public.pyre_agent_routines for update
  using (public.is_admin());

create policy "admins can delete pyre agent routines"
  on public.pyre_agent_routines for delete
  using (public.is_admin());

create policy "admins can select pyre agent routine runs"
  on public.pyre_agent_routine_runs for select
  using (public.is_admin());

create policy "admins can insert pyre agent routine runs"
  on public.pyre_agent_routine_runs for insert
  with check (public.is_admin());

create policy "admins can update pyre agent routine runs"
  on public.pyre_agent_routine_runs for update
  using (public.is_admin());

-- New tables don't inherit the service-role grants the app relies on.
grant select, insert, update, delete on public.pyre_agent_routines to service_role;
grant select, insert, update on public.pyre_agent_routine_runs to service_role;

-- A finished routine run tells its owner, in the bell.
alter table public.staff_notifications drop constraint staff_notifications_kind_check;
alter table public.staff_notifications
  add constraint staff_notifications_kind_check check (
    kind in (
      'admin_message',
      'message_reply',
      'sop_updated',
      'schedule_change',
      'shift_note_reply',
      'sub_request',
      'goal_activity',
      'agent_suggestion',
      'inventory_low',
      'agent_routine'
    )
  );

comment on table public.pyre_agent_routines is
  'Requests saved for Pyre Agent (/admin/ask) to run on a cadence (daily, weekly days, or a day of the month, at an Eastern hour), as their owner; each run opens a conversation in the owner''s history.';
comment on table public.pyre_agent_routine_runs is
  'Each time a Pyre Agent routine ran: the slot, the conversation it opened, and whether it answered or failed.';
