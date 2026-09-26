-- Agent suggestions: things an AI agent proposes doing — create a task card,
-- comment on an existing card, edit an SOP — that nothing ever applies until
-- an admin approves it. Shift notes are the first source: when the
-- classifier finds an action in a note (or an admin asks), the pyre-agents
-- "suggester" reads the note, the boards, the open cards and the SOPs, and
-- files what it thinks should happen next. An admin then edits any of it
-- (a card title, a comment's wording, an SOP diff) and approves or dismisses
-- each suggestion on its own.
--
-- Generic on both ends, so a new source (a guest profile, an inventory count)
-- or a new kind of action (update a guest field) is one more value in the
-- checks below plus a handler in apps/integrations src/lib/suggestions:
--   source_type/source_id — where the suggestion came from, and where every
--                           suggestion links back to (not a foreign key; the
--                           cleanup trigger at the bottom stands in for one);
--   kind + payload        — what to do, validated in the app per kind.
--
-- Lifecycle (apps/integrations src/lib/suggestions):
--   0. A run is filed (agent_suggestion_runs, 'queued') — automatically after
--      a classification finds an action, or from an admin's Suggest button —
--      and a QStash job starts a pyre-agents session for it.
--   1. The agent posts its suggestions (possibly none) to
--      /api/agent/suggestions, which validates each against the live data,
--      supersedes the source's unedited pending suggestions, inserts these as
--      'pending' and closes the run 'done'.
--   2. An admin edits (edited_payload) and approves: the row is claimed
--      ('applying'), the action applied with the admin as its actor, and the
--      row closed 'approved' with what was applied and what it made
--      (result_type/result_id). Or the admin dismisses it.
--
-- payload is the agent's original and is never updated: edited_payload and
-- applied_payload sit beside it, so what the AI proposed and what a person
-- changed stay separately visible.

create table public.agent_suggestion_runs (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('shift_note')),
  source_id uuid not null,
  -- sha256 of the source's text when the run was filed (the same hash the
  -- classifier uses), so a suggestion can say the note changed since.
  source_hash text not null,
  -- auto: filed after a classification; manual: an admin's Suggest button.
  trigger text not null check (trigger in ('auto', 'manual')),
  -- The admin who asked, for manual runs.
  requested_by text,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed')),
  suggestion_count integer not null default 0 check (suggestion_count >= 0),
  -- The pyre-agents session that did the work.
  agent_session_id text,
  error text check (error is null or char_length(error) <= 1000),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- An automatic run happens at most once per version of a source's text: a
-- redelivered job claims nothing, and a note whose suggestions were
-- dismissed is not re-suggested until someone edits it. Manual runs are
-- never limited.
create unique index agent_suggestion_runs_auto_once
  on public.agent_suggestion_runs (source_type, source_id, source_hash)
  where trigger = 'auto';

create index agent_suggestion_runs_source_idx
  on public.agent_suggestion_runs (source_type, source_id, created_at desc);

create trigger agent_suggestion_runs_set_updated_at
  before update on public.agent_suggestion_runs
  for each row execute function public.set_updated_at();

create table public.agent_suggestions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_suggestion_runs (id) on delete cascade,
  -- Order within the run, as the agent listed them.
  position integer not null default 0,
  kind text not null
    check (kind in ('board_card.create', 'board_card.comment', 'sop.edit')),
  -- pending → applying → approved; pending → dismissed; pending → superseded
  -- (a newer run replaced it before anyone edited it); applying → pending
  -- again when applying failed (error says why).
  status text not null default 'pending'
    check (status in ('pending', 'applying', 'approved', 'dismissed', 'superseded')),
  -- Copied from the run so the per-source reads need no join.
  source_type text not null check (source_type in ('shift_note')),
  source_id uuid not null,
  source_hash text not null,
  -- The agent's proposal, as validated when it was filed. Never updated.
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  -- An admin's working copy, saved as they edit; null until someone does.
  edited_payload jsonb check (edited_payload is null or jsonb_typeof(edited_payload) = 'object'),
  edited_by text,
  edited_at timestamptz,
  -- Why the agent suggested it, for the admin reading it.
  rationale text not null default '' check (char_length(rationale) <= 2000),
  confidence real check (confidence is null or (confidence >= 0 and confidence <= 1)),
  -- The existing record the suggestion acts on, when it acts on one (the
  -- card a comment goes on, the SOP an edit changes).
  target_type text check (target_type in ('board_card', 'sop')),
  target_id uuid,
  -- What approving made: the new card, the comment event, the SOP version.
  result_type text check (result_type in ('board_card', 'board_event', 'sop_version')),
  result_id uuid,
  -- Exactly what was applied (the edited payload, or the original).
  applied_payload jsonb,
  decided_by text,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 1000),
  -- Why the last attempt to apply it failed; cleared on success.
  error text check (error is null or char_length(error) <= 1000),
  agent_session_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A person decided exactly the approved and dismissed ones.
  constraint agent_suggestions_decided_check
    check ((status in ('approved', 'dismissed')) = (decided_at is not null))
);

create index agent_suggestions_source_idx
  on public.agent_suggestions (source_type, source_id, created_at);

-- The inbox and the nav badge read pending rows only.
create index agent_suggestions_pending_idx
  on public.agent_suggestions (created_at desc)
  where status = 'pending';

create index agent_suggestions_run_idx
  on public.agent_suggestions (run_id);

create trigger agent_suggestions_set_updated_at
  before update on public.agent_suggestions
  for each row execute function public.set_updated_at();

alter table public.agent_suggestion_runs enable row level security;
alter table public.agent_suggestions enable row level security;

-- App access is service-role (bypasses RLS); forward-looking convention like
-- the shift notes tables. No delete policies: the rows are the audit trail of
-- what agents proposed and what people did with it.
create policy "admins can select agent suggestion runs"
  on public.agent_suggestion_runs for select
  using (public.is_admin());

create policy "admins can insert agent suggestion runs"
  on public.agent_suggestion_runs for insert
  with check (public.is_admin());

create policy "admins can update agent suggestion runs"
  on public.agent_suggestion_runs for update
  using (public.is_admin());

create policy "admins can select agent suggestions"
  on public.agent_suggestions for select
  using (public.is_admin());

create policy "admins can insert agent suggestions"
  on public.agent_suggestions for insert
  with check (public.is_admin());

create policy "admins can update agent suggestions"
  on public.agent_suggestions for update
  using (public.is_admin());

-- Links back. A card or an SOP version made by approving a suggestion names
-- it, and through it the note it came from. Unique, so a retried approval can
-- find what the first attempt made instead of making it twice.
alter table public.board_cards drop constraint board_cards_source_check;
alter table public.board_cards
  add constraint board_cards_source_check
  check (source in ('manual', 'intake', 'form', 'suggestion'));

alter table public.board_cards
  add column suggestion_id uuid references public.agent_suggestions (id) on delete set null;

create unique index board_cards_suggestion_idx
  on public.board_cards (suggestion_id)
  where suggestion_id is not null;

alter table public.sop_versions
  add column suggestion_id uuid references public.agent_suggestions (id) on delete set null;

create unique index sop_versions_suggestion_idx
  on public.sop_versions (suggestion_id)
  where suggestion_id is not null;

comment on column public.board_cards.suggestion_id is
  'The agent suggestion an admin approved to create this card (source = suggestion); its source_type/source_id is where the work came from.';
comment on column public.sop_versions.suggestion_id is
  'The agent suggestion an admin approved to save this version, if any.';

-- A shift note's thread records what happened to its suggestions.
--   suggestion — { suggestion_id, suggestion_kind, action: 'approved' |
--                  'dismissed', result?: { type, id, href, label } }
alter table public.shift_note_replies drop constraint shift_note_replies_kind_check;
alter table public.shift_note_replies
  add constraint shift_note_replies_kind_check
  check (kind in ('comment', 'status', 'edit', 'classification', 'suggestion'));

-- Admins hear about new suggestions in the bell.
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
      'agent_suggestion'
    )
  );

-- Deleting a source drops what nobody decided on yet; decided suggestions
-- stay, since the cards and SOP versions they made still point at them.
-- Generic over sources, like delete_content_classification.
create or replace function public.delete_agent_suggestions_for_source()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.agent_suggestions
  where source_type = tg_argv[0]
    and source_id = old.id
    and status in ('pending', 'applying', 'superseded');
  delete from public.agent_suggestion_runs r
  where r.source_type = tg_argv[0]
    and r.source_id = old.id
    and not exists (select 1 from public.agent_suggestions s where s.run_id = r.id);
  return old;
end;
$$;

create trigger shift_notes_delete_agent_suggestions
  after delete on public.shift_notes
  for each row execute function public.delete_agent_suggestions_for_source('shift_note');

comment on table public.agent_suggestion_runs is
  'One pass of an AI agent over a source record (a shift note) looking for follow-up work; closed by the agent posting its suggestions, possibly none.';
comment on table public.agent_suggestions is
  'Actions an AI agent proposed (create a card, comment on a card, edit an SOP) from a source record. Nothing is applied until an admin approves; payload is the original, edited_payload the admin''s changes, applied_payload what was done.';
