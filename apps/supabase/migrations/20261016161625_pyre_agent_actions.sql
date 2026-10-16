-- Pyre Agent actions: changes to the boards that Pyre Agent (/admin/ask)
-- proposes in a conversation — a new board, a new card, a card moved or
-- re-assigned or re-dated, a comment, a KPI measurement — and that nothing
-- applies until the person in the conversation presses Apply on it.
--
-- Unlike agent_suggestions (proposals about a record, reviewed by admins in
-- an inbox), these belong to one conversation and one person: the one who
-- asked. Each row holds the exact request the dashboard's own board API
-- would take (request: method, path, body). Applying replays that request
-- through the same route as the person, so their own grants decide whether
-- it goes through, and the boards' own trails record them as the actor.
--
-- Lifecycle (apps/integrations src/lib/pyre-agent):
--   1. The agent calls a propose_* tool; pyre-agents posts it to
--      /api/agent/pyre, which checks it against the live boards and the
--      asker's access, resolves names to ids, and inserts it 'pending'.
--   2. The asker presses Apply: the row is claimed ('applying'), the request
--      replayed, and the row closed 'applied' with a link to what it made —
--      or put back to 'pending' with the error, so it can be fixed on the
--      board and tried again. Or the asker presses Dismiss ('dismissed').
--
-- Access is enforced in the app (/api/admin/agent-actions: the Ask page
-- grant, and only the asker's own rows); app access is service-role, so the
-- policies below are the admin-only convention the other admin tables follow.

create table public.pyre_agent_actions (
  id uuid primary key default gen_random_uuid(),
  -- The pyre-agents session (conversation) and turn it was proposed in.
  session_id text not null check (char_length(session_id) between 1 and 200),
  turn_id text check (turn_id is null or char_length(turn_id) <= 200),
  -- Session email of the person in the conversation: the only one who may
  -- apply or dismiss it.
  asked_by text not null check (char_length(asked_by) between 3 and 320),
  kind text not null
    check (kind in (
      'board.create',
      'board_card.create',
      'board_card.update',
      'board_card.comment',
      'goal_kpi.measure'
    )),
  -- One line for the card in the chat ("New task on Tasks: Order towels").
  summary text not null check (char_length(summary) between 1 and 300),
  -- The rest of what it would do, a line per change, for the card's body.
  details jsonb not null default '[]'::jsonb check (jsonb_typeof(details) = 'array'),
  -- Why the agent proposed it.
  rationale text not null default '' check (char_length(rationale) <= 2000),
  -- The dashboard API request applying it replays: { method, path, body }.
  request jsonb not null check (jsonb_typeof(request) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'applying', 'applied', 'dismissed')),
  -- What applying made or changed, for the link on the card.
  result_label text check (result_label is null or char_length(result_label) <= 300),
  result_href text check (result_href is null or char_length(result_href) <= 500),
  -- Why the last attempt to apply it failed; cleared on success.
  error text check (error is null or char_length(error) <= 1000),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A person decided exactly the applied and dismissed ones.
  constraint pyre_agent_actions_decided_check
    check ((status in ('applied', 'dismissed')) = (decided_at is not null))
);

-- A conversation reads its own proposals back in order.
create index pyre_agent_actions_session_idx
  on public.pyre_agent_actions (session_id, created_at);

create trigger pyre_agent_actions_set_updated_at
  before update on public.pyre_agent_actions
  for each row execute function public.set_updated_at();

alter table public.pyre_agent_actions enable row level security;

create policy "admins can select pyre agent actions"
  on public.pyre_agent_actions for select
  using (public.is_admin());

create policy "admins can insert pyre agent actions"
  on public.pyre_agent_actions for insert
  with check (public.is_admin());

create policy "admins can update pyre agent actions"
  on public.pyre_agent_actions for update
  using (public.is_admin());

-- No delete policy: the rows are the record of what the agent proposed and
-- what the person did with it.

-- New tables don't inherit the service-role grants the app relies on.
grant select, insert, update on public.pyre_agent_actions to service_role;

comment on table public.pyre_agent_actions is
  'Board changes Pyre Agent proposed in a conversation (/admin/ask), applied only when the asker presses Apply: the dashboard API request to replay, its status, and what it made.';
