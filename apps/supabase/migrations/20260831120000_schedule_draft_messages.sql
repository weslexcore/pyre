-- Draft conversation thread: the admin's notes to the scheduling agent and
-- the agent's rationale replies, one row per message, so a draft can be
-- refined over multiple turns ("swap Liz and Omar on Thursday") with the
-- whole exchange visible on /admin/schedule until the draft is decided.
--
-- The thread is keyed by the Eve agent session id, not the proposal id:
-- every refinement supersedes the week's open proposal, but the session (and
-- with it the conversation) stays the same, and schedule_proposals already
-- stamps agent_session_id on each superseding row. When a dead session has
-- to be replaced by a fresh one (expired sessions, cron drafts), the refine
-- route re-keys the old rows to the new session id so the thread follows.

create table public.schedule_draft_messages (
  id uuid primary key default gen_random_uuid(),
  -- Eve session id of the drafting conversation; the thread key
  agent_session_id text not null,
  -- Monday of the drafted week (matches weekStartOf in schedule-core);
  -- denormalised so a week's thread is findable without joining proposals
  week_start date not null,
  -- admin = a note the admin sent (initial draft note or a refinement);
  -- agent = the rationale of the proposal that turn produced
  role text not null check (role in ('admin', 'agent')),
  content text not null,
  -- for agent rows: the proposal that turn produced. Proposal rows are only
  -- ever flipped to 'superseded', never deleted, so set null is a safety net.
  proposal_id uuid references public.schedule_proposals (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Threads are read per session in message order.
create index schedule_draft_messages_session_idx
  on public.schedule_draft_messages (agent_session_id, created_at);

-- The change log gains refine rows (an admin sending a follow-up note to an
-- open draft's agent session).
alter table public.schedule_changes
  drop constraint schedule_changes_action_check;
alter table public.schedule_changes
  add constraint schedule_changes_action_check
    check (
      action in (
        'create', 'update', 'delete',
        'propose', 'approve', 'discard', 'accept_item', 'reject_item',
        'sync', 'deny', 'refine'
      )
    );

-- App access is service-role (bypasses RLS); enabling RLS with an
-- admin-select policy is forward-looking convention, same as the other
-- scheduling tables. Rows are append-only from the app's point of view
-- (apart from the session re-key), so select is the only policy.
alter table public.schedule_draft_messages enable row level security;

create policy "admins can select schedule draft messages"
  on public.schedule_draft_messages for select to authenticated using (public.is_admin());
