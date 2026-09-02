-- Audit log for the knowledge assistant (pyre-agents, knowledge role): one
-- row per question a staff member asks, with who asked, what the assistant
-- could see on their behalf, which tools it called, and the answer it gave.
-- Admins review it at /admin/ask/log to judge answer quality and to check
-- that nobody is reaching knowledge the dashboard would not show them.
--
-- Rows are written by the agent itself, not by the dashboard proxy, so a
-- closed browser tab never loses the record: the Eve channel handlers stamp
-- the asker and scope when a turn starts, the message hook records the
-- question, and the turn's tool calls, answer, and outcome follow as the
-- session streams them (apps/agents/agent/lib/knowledge/audit.ts). Every
-- write is an upsert on (session_id, turn_id), since the handlers run
-- independently and in no guaranteed order.

create table public.knowledge_queries (
  id uuid primary key default gen_random_uuid(),
  -- The Eve session (one conversation) and the turn within it (one question).
  session_id text not null,
  turn_id text not null,
  -- Session email of the staff member who asked (from the dashboard session,
  -- never the request body). Empty until the channel handler has run.
  asked_by text not null default '',
  -- The access the assistant was given for this question: SOP role + email,
  -- shift-notes / incidents scope ('all' | 'mine' | null), water page.
  viewer_scope jsonb not null default '{}'::jsonb,
  -- The question as typed (control characters stripped by the dashboard).
  question text not null default '',
  -- The assistant's final answer, markdown; null until it finishes.
  answer text,
  -- Tool calls in order: [{ "tool": "search_knowledge_base", "input": {...} }]
  tool_calls jsonb not null default '[]'::jsonb check (jsonb_typeof(tool_calls) = 'array'),
  status text not null default 'pending'
    check (status in ('pending', 'answered', 'failed', 'cancelled')),
  -- Failure detail when status is 'failed'.
  error text,
  asked_at timestamptz not null default now(),
  answered_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (session_id, turn_id)
);

-- The log reads newest first, optionally per person.
create index knowledge_queries_asked_at_idx
  on public.knowledge_queries (asked_at desc);

create index knowledge_queries_asked_by_idx
  on public.knowledge_queries (asked_by, asked_at desc);

create trigger knowledge_queries_set_updated_at
  before update on public.knowledge_queries
  for each row execute function public.set_updated_at();

alter table public.knowledge_queries enable row level security;

-- App access is service-role (bypasses RLS); forward-looking convention like
-- the other admin tables: only admins may ever read the log directly.
create policy "admins can select knowledge queries"
  on public.knowledge_queries for select
  using (public.is_admin());

comment on table public.knowledge_queries is
  'Audit log of staff questions to the knowledge assistant: asker, the access they had, tool calls, and the answer. Written by pyre-agents; reviewed on /admin/ask/log.';
