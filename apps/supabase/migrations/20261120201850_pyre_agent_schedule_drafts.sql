-- Schedule drafts from Pyre Agent. Someone who manages the schedule can ask
-- Pyre Agent (/admin/ask) to draft a week, or to revise the week's open
-- draft, and confirm parts of it from the chat. Two pieces of storage:
--
-- 1. schedule_draft_requests: one row per draft or revision a person asked
--    for, whether from the board's buttons or from Pyre Agent. It records
--    who asked and, for a Pyre Agent request, the conversation it came from,
--    so that when the scheduler saves its proposal (/api/agent/proposals)
--    the person who asked is told it is ready, with a link back to where
--    they asked. It also lets the chat show "drafting…" until the proposal
--    arrives. The Monday cron that used to draft the next week is gone; a
--    Pyre Agent routine does that job now, and these rows cover it too.
--
-- 2. A new pyre_agent_actions kind, 'schedule.review': the agent proposes
--    which draft items to accept or reject, and nothing changes until the
--    person presses Apply. Applying replays the board's own review calls
--    (/api/admin/schedule-proposals) as that person.

-- ---------------------------------------------------------------------------
-- 1. Draft requests
-- ---------------------------------------------------------------------------

create table public.schedule_draft_requests (
  id uuid primary key default gen_random_uuid(),
  -- Monday of the week being drafted (matches weekStartOf in schedule-core).
  week_start date not null,
  -- 'draft' starts a fresh draft; 'refine' revises the week's open draft.
  kind text not null check (kind in ('draft', 'refine')),
  -- The scheduler's Eve session that will save the proposal. Matched against
  -- the agentSessionId save_proposal reports.
  agent_session_id text not null check (char_length(agent_session_id) <= 200),
  -- Who asked (session email, lowercased).
  requested_by text not null check (char_length(requested_by) <= 320),
  -- Where they asked: 'board' (the schedule board's buttons) or 'pyre_agent'
  -- (a Pyre Agent conversation, including a routine's).
  origin text not null check (origin in ('board', 'pyre_agent')),
  -- The Pyre Agent session the request came from, for the link back.
  pyre_session_id text check (char_length(pyre_session_id) <= 200),
  -- The note the person gave, if any (already sanitised by the app).
  note text not null default '' check (char_length(note) <= 2000),
  -- The proposal the scheduler saved for this request, once it has.
  proposal_id uuid references public.schedule_proposals (id) on delete set null,
  -- When the proposal arrived (the request is settled).
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.schedule_draft_requests is
  'Schedule drafts and revisions people asked for, from the board or Pyre Agent: who asked, the scheduler session doing the work, and the proposal it saved. Used to tell the person when the draft is ready and to show drafting progress in the chat.';

create index schedule_draft_requests_session_idx
  on public.schedule_draft_requests (agent_session_id);

create index schedule_draft_requests_week_idx
  on public.schedule_draft_requests (week_start, created_at desc);

alter table public.schedule_draft_requests enable row level security;

-- Admin-only through the API, like the rest of the scheduling tables; the
-- app reads and writes with the service role.
create policy "admins can select schedule draft requests"
  on public.schedule_draft_requests for select to authenticated
  using (public.is_admin());

create policy "admins can insert schedule draft requests"
  on public.schedule_draft_requests for insert to authenticated
  with check (public.is_admin());

create policy "admins can update schedule draft requests"
  on public.schedule_draft_requests for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "admins can delete schedule draft requests"
  on public.schedule_draft_requests for delete to authenticated
  using (public.is_admin());

-- New tables don't inherit the service-role grants the app relies on.
grant select, insert, update, delete on public.schedule_draft_requests to service_role;

-- ---------------------------------------------------------------------------
-- 2. Pyre Agent proposals that review a schedule draft
-- ---------------------------------------------------------------------------

alter table public.pyre_agent_actions
  drop constraint pyre_agent_actions_kind_check;
alter table public.pyre_agent_actions
  add constraint pyre_agent_actions_kind_check
  check (kind in (
    'board.create',
    'board_card.create',
    'board_card.update',
    'board_card.comment',
    'goal_kpi.measure',
    'inventory.update',
    'inventory.create',
    'schedule.review'
  ));

comment on table public.pyre_agent_actions is
  'Changes Pyre Agent proposed in a conversation (/admin/ask) to the boards, the inventory, or a schedule draft, applied only when the asker presses Apply: the dashboard API request to replay, its status, and what it made.';
