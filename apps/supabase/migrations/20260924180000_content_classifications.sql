-- Content classifications: what Jev (TypeSafe AI's System One evaluation
-- model, called through the pyre-agents Eve app) found in a piece of
-- staff-written text — shift notes first. Jev answers one yes/no question per
-- "signal" type with a probability: an action someone needs to take, a
-- question someone needs to answer, a record that needs updating, feedback, a
-- safety concern. The vocabulary lives in @pyre/signals-core
-- (packages/signals-core), shared by the agents app that asks and the
-- integrations app that stores and shows the answers, so adding a signal type
-- needs no migration: signals is jsonb, validated in the app against that
-- registry.
--
-- One row per classified record, keyed (subject_type, subject_id), rather
-- than a column on each table: any record with text can be classified by
-- adding a subject type (the check below) and the cleanup trigger at the
-- bottom, with no new table.
--
-- Lifecycle (apps/integrations src/lib/classify), all of it in the
-- background after the write's response has gone out:
--   1. A write to the record (a new note, an edited body) upserts the row as
--      'pending' with a fresh request_id and the hash of the text.
--   2. It asks pyre-agents (POST /pyre/classify), which asks Jev, and writes
--      the answer back guarded on that request_id: 'done' with its signals,
--      or 'failed' with the error. A run whose request_id was replaced in the
--      meantime (the text changed again, or the record was deleted) writes
--      nothing.
--   3. The hourly classify-sweep cron job re-runs records whose result never
--      landed or failed, up to three attempts per text; admins can re-run any
--      record from the page.

create table public.content_classifications (
  id uuid primary key default gen_random_uuid(),
  -- What kind of record, and which one. Not a foreign key: the subject lives
  -- in whichever table its type names. Cleanup is the trigger below.
  subject_type text not null check (subject_type in ('shift_note')),
  subject_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  -- [{ "type": "action", "probability": 0.91 }, ...]: the signals at or above
  -- their thresholds, most likely first; empty when the text carries nothing
  -- to act on.
  signals jsonb not null default '[]'::jsonb check (jsonb_typeof(signals) = 'array'),
  -- The current (or last) run; rotated on every run so a stale run finishing
  -- late can never overwrite a newer result.
  request_id uuid not null default gen_random_uuid(),
  -- sha256 of the text that was sent, so an edit that leaves the text alone
  -- (a date change) does not re-run the classifier.
  content_hash text not null,
  -- Runs for the current text; the sweep stops retrying at three.
  attempts integer not null default 1 check (attempts >= 1),
  -- The evaluation model that answered, e.g. typesafe-ai/jev.
  model text,
  -- Why the last attempt failed; null otherwise.
  error text,
  requested_at timestamptz not null default now(),
  classified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_type, subject_id)
);

-- Each run writes its answer back by request id.
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
  'What Jev found in staff-written text (shift notes first): signals such as actions, questions, and updates with their probabilities, keyed by (subject_type, subject_id). Vocabulary lives in @pyre/signals-core.';
