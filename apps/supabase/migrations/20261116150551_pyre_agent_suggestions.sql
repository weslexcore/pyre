-- Pyre Agent files suggestions the way the shift-note suggester does.
--
-- Until now an agent suggestion always came from a shift note. Pyre Agent
-- (/admin/ask) can now suggest SOP edits, new admin messages, and edits to
-- existing messages from a conversation. They land in the same
-- agent_suggestions table, with the same editors, the same approvers (admins
-- and the Suggestions page), the same inbox and notifications. Nothing is
-- applied until someone approves it.
--
-- 1. The source: 'pyre_agent', a conversation. A conversation is named by its
--    first eve session id, which is text rather than a uuid, so source_id
--    becomes text on both tables. Existing shift-note ids cast as they are.
--    The delete trigger compares against old.id::text.
-- 2. Two new kinds: 'message.create' (approving saves a draft message) and
--    'message.edit' (approving rewrites a message's title and body). Both
--    point at admin_message as target and result.
-- 3. admin_messages.suggestion_id: which approved suggestion made a draft, so
--    a retried approval finds the draft the first attempt saved.

-- ---------------------------------------------------------------------------
-- 1. Pyre Agent conversations as a source
-- ---------------------------------------------------------------------------

alter table public.agent_suggestion_runs
  alter column source_id type text using source_id::text;
alter table public.agent_suggestions
  alter column source_id type text using source_id::text;

alter table public.agent_suggestion_runs
  drop constraint agent_suggestion_runs_source_type_check;
alter table public.agent_suggestion_runs
  add constraint agent_suggestion_runs_source_type_check
  check (source_type in ('shift_note', 'pyre_agent'));

alter table public.agent_suggestions
  drop constraint agent_suggestions_source_type_check;
alter table public.agent_suggestions
  add constraint agent_suggestions_source_type_check
  check (source_type in ('shift_note', 'pyre_agent'));

alter table public.agent_suggestion_runs
  add constraint agent_suggestion_runs_source_id_length
  check (char_length(source_id) between 1 and 200);
alter table public.agent_suggestions
  add constraint agent_suggestions_source_id_length
  check (char_length(source_id) between 1 and 200);

-- Same as before, comparing against the text column.
create or replace function public.delete_agent_suggestions_for_source()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.agent_suggestions
  where source_type = tg_argv[0]
    and source_id = old.id::text
    and status in ('pending', 'applying', 'superseded');
  delete from public.agent_suggestion_runs r
  where r.source_type = tg_argv[0]
    and r.source_id = old.id::text
    and not exists (select 1 from public.agent_suggestions s where s.run_id = r.id);
  return old;
end;
$$;

comment on column public.agent_suggestions.source_id is
  'The record it came from: a shift note id (shift_note), or a Pyre Agent conversation''s first session id (pyre_agent).';
comment on column public.agent_suggestion_runs.source_id is
  'The record looked at: a shift note id (shift_note), or a Pyre Agent conversation''s first session id (pyre_agent). A pyre_agent run is filed and closed in one step, when the agent suggests something.';

-- ---------------------------------------------------------------------------
-- 2. Message suggestions
-- ---------------------------------------------------------------------------

alter table public.agent_suggestions
  drop constraint agent_suggestions_kind_check;
alter table public.agent_suggestions
  add constraint agent_suggestions_kind_check
  check (kind in (
    'board_card.create',
    'board_card.comment',
    'sop.edit',
    'shift_assignment.update',
    'inventory.count',
    'message.create',
    'message.edit'
  ));

alter table public.agent_suggestions
  drop constraint agent_suggestions_target_type_check;
alter table public.agent_suggestions
  add constraint agent_suggestions_target_type_check
  check (target_type in (
    'board_card',
    'sop',
    'shift_assignment',
    'inventory_item',
    'admin_message'
  ));

alter table public.agent_suggestions
  drop constraint agent_suggestions_result_type_check;
alter table public.agent_suggestions
  add constraint agent_suggestions_result_type_check
  check (result_type in (
    'board_card',
    'board_event',
    'sop_version',
    'shift_assignment',
    'inventory_item',
    'admin_message'
  ));

-- ---------------------------------------------------------------------------
-- 3. Which suggestion made a draft message
-- ---------------------------------------------------------------------------

alter table public.admin_messages
  add column suggestion_id uuid references public.agent_suggestions (id) on delete set null;

create unique index admin_messages_suggestion_idx
  on public.admin_messages (suggestion_id)
  where suggestion_id is not null;

comment on column public.admin_messages.suggestion_id is
  'The agent suggestion (message.create) whose approval saved this message as a draft, if any.';
