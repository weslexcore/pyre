-- Pyre Agent conversations that outlive their session. An agent session ends
-- (eve retires sessions after 30 days, and a deploy can strand one); when
-- someone writes into a conversation whose session has ended, the dashboard
-- starts a new session, hands it the conversation so far (every question and
-- answer, from knowledge_queries), and links it here, so the person carries
-- on in one conversation: one row in the sidebar, every turn in order on
-- reopening, the proposals from every session under their answers.
--
-- conversation_id is the conversation's first session (the one its earliest
-- knowledge_queries rows carry); a session with no row here is its own
-- conversation. Written by /api/admin/knowledge-ask; read by the history,
-- the actions, and the routine-origin lookups (apps/integrations
-- lib/knowledge/conversation.ts).
--
-- Access is enforced in the app (only the owner's own conversations); app
-- access is service-role, so the policies below are the admin-only
-- convention the other admin tables follow.

create table public.pyre_agent_session_links (
  -- The continuing session.
  session_id text primary key check (char_length(session_id) between 1 and 200),
  -- The conversation it continues: that conversation's first session.
  conversation_id text not null check (char_length(conversation_id) between 1 and 200),
  -- Session email of the person whose conversation it is.
  owner_email text not null check (char_length(owner_email) between 3 and 320),
  -- How many earlier questions and answers the new session was handed.
  carried_turns integer not null default 0 check (carried_turns >= 0),
  created_at timestamptz not null default now(),
  constraint pyre_agent_session_links_not_self check (session_id <> conversation_id)
);

-- A conversation's sessions, in the order they took over.
create index pyre_agent_session_links_conversation_idx
  on public.pyre_agent_session_links (conversation_id, created_at);

alter table public.pyre_agent_session_links enable row level security;

create policy "admins can select pyre agent session links"
  on public.pyre_agent_session_links for select
  using (public.is_admin());

create policy "admins can insert pyre agent session links"
  on public.pyre_agent_session_links for insert
  with check (public.is_admin());

-- New tables don't inherit the service-role grants the app relies on.
grant select, insert on public.pyre_agent_session_links to service_role;

comment on table public.pyre_agent_session_links is
  'Pyre Agent sessions that continue an earlier conversation whose session ended: the new session, the conversation (its first session), and the owner. Lets the history show one conversation across sessions.';
