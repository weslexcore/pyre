-- Content classifications: what the pyre-agents classifier found in a piece
-- of staff-written text — shift notes first. The classifier reads the text
-- and reports "signals": an action someone needs to take, a question someone
-- needs to answer, a record that needs updating, feedback, a safety concern.
-- The vocabulary lives in @pyre/signals-core (packages/signals-core), shared
-- by the agent that detects signals and the app that stores and shows them,
-- so adding a signal type needs no migration: signals is jsonb, validated in
-- the app against that registry.
--
-- One row per classified record, keyed (subject_type, subject_id), rather
-- than a column on each table: any record with text can be classified by
-- adding a subject type (the check below) and the cleanup trigger at the
-- bottom, with no new table.
--
-- Lifecycle (apps/integrations src/lib/classify):
--   1. A write to the record (a new note, an edited body) upserts the row as
--      'pending' with a fresh request_id and the hash of the text, then
--      starts a classifier session carrying that request_id.
--   2. The agent saves through POST /api/agent/classifications, naming only
--      the request_id; the row flips to 'done' with its signals. A save for a
--      request_id that is no longer on the row (the text changed again, or
--      the record was deleted) is refused as superseded.
--   3. A session that could not be started marks the row 'failed'; admins
--      can re-run it from the page.

create table public.content_classifications (
  id uuid primary key default gen_random_uuid(),
  -- What kind of record, and which one. Not a foreign key: the subject lives
  -- in whichever table its type names. Cleanup is the trigger below.
  subject_type text not null check (subject_type in ('shift_note')),
  subject_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  -- [{ "type": "action", "summary": "Restock towels" }, ...]; empty when the
  -- text carries nothing to act on.
  signals jsonb not null default '[]'::jsonb check (jsonb_typeof(signals) = 'array'),
  -- The request the current (or last) classifier session answers; rotated on
  -- every re-request so a stale session can never overwrite a newer result.
  request_id uuid not null default gen_random_uuid(),
  -- sha256 of the text that was sent, so an edit that leaves the text alone
  -- (a date change) does not re-run the classifier.
  content_hash text not null,
  -- The pyre-agents session that answered (or is answering), for debugging.
  agent_session_id text,
  -- Why the last attempt failed; null otherwise.
  error text,
  requested_at timestamptz not null default now(),
  classified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_type, subject_id)
);

-- The agent's save looks the row up by request id.
create unique index content_classifications_request_idx
  on public.content_classifications (request_id);

create trigger content_classifications_set_updated_at
  before update on public.content_classifications
  for each row execute function public.set_updated_at();

alter table public.content_classifications enable row level security;

-- App access is service-role (bypasses RLS); forward-looking convention like
-- the shift notes tables.
create policy "admins can select content classifications"
  on public.content_classifications for select
  using (public.is_admin());

create policy "admins can insert content classifications"
  on public.content_classifications for insert
  with check (public.is_admin());

create policy "admins can update content classifications"
  on public.content_classifications for update
  using (public.is_admin());

create policy "admins can delete content classifications"
  on public.content_classifications for delete
  using (public.is_admin());

-- Deleting a record deletes its classification. Generic over subjects: the
-- trigger passes its subject type as the argument, so a new subject table
-- only needs its own `create trigger ... ('<subject_type>')`.
create or replace function public.delete_content_classification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.content_classifications
  where subject_type = tg_argv[0] and subject_id = old.id;
  return old;
end;
$$;

create trigger shift_notes_delete_classification
  after delete on public.shift_notes
  for each row execute function public.delete_content_classification('shift_note');

comment on table public.content_classifications is
  'What the AI classifier found in staff-written text (shift notes first): signals such as actions, questions, and updates, keyed by (subject_type, subject_id). Vocabulary lives in @pyre/signals-core.';
