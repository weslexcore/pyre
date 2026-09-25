-- Shift note activity: everything that happens to a note becomes an entry in
-- its thread, so the history of a note reads top to bottom — who replied,
-- who moved it to "to do", who edited it, what Jev found each time it read
-- it. Until now only replies lived in the thread; a status change or an edit
-- just overwrote a "marked by" / "edited by" stamp on the note, and a Jev
-- re-run replaced the last answer, so nothing showed how a note got to where
-- it is. As more actions land on notes, each one adds a kind here rather than
-- another stamp on the card.
--
-- shift_note_replies keeps its name and its rows (every existing row is a
-- comment); it gains:
--
--   kind — comment (a person writing in the thread, as before), status (an
--          admin moved the note between open / todo / resolved), edit (the
--          note's text or date changed), classification (Jev read the note).
--   data — what the event carries: { from, to } for status, { fields } for
--          edit, { signals, model, requested_by } for classification.
--
-- Events are written by the app, never edited or deleted from the page
-- (lib/shift-notes/access: canTouchReply is comments only). Visibility is
-- the existing is_private flag: status and edit events are shared with the
-- author, like the status badge always was; classification events stay with
-- the admins, like the signal chips.
--
-- A classification event has no author_email: Jev wrote it. The admin who
-- asked for the run, if one did, is data.requested_by.

alter table public.shift_note_replies
  add column kind text not null default 'comment'
    check (kind in ('comment', 'status', 'edit', 'classification')),
  add column data jsonb
    check (data is null or jsonb_typeof(data) = 'object'),
  alter column author_email drop not null,
  alter column body set default '',
  -- Everyone but Jev signs their entries.
  add constraint shift_note_replies_author_check
    check (author_email is not null or kind = 'classification');

-- Only a comment needs words; an event may carry none.
alter table public.shift_note_replies
  drop constraint shift_note_replies_body_check,
  add constraint shift_note_replies_body_check
    check (
      char_length(body) <= 4000
      and (kind <> 'comment' or length(btrim(body)) > 0)
    );

-- Backfill: the last status change of every triaged note (the only one the
-- note remembers) ...
insert into public.shift_note_replies
  (note_id, kind, author_email, body, is_private, data, created_at, updated_at)
select
  n.id,
  'status',
  n.status_by,
  '',
  false,
  jsonb_build_object('to', n.status),
  n.status_at,
  n.status_at
from public.shift_notes n
where n.status_by is not null and n.status_at is not null;

-- ... and every note's last Jev answer.
insert into public.shift_note_replies
  (note_id, kind, author_email, body, is_private, data, created_at, updated_at)
select
  c.subject_id,
  'classification',
  null,
  '',
  true,
  jsonb_build_object('signals', c.signals, 'model', c.model),
  c.classified_at,
  c.classified_at
from public.content_classifications c
join public.shift_notes n on n.id = c.subject_id
where c.subject_type = 'shift_note'
  and c.status = 'done'
  and c.classified_at is not null;

comment on column public.shift_note_replies.kind is
  'comment (a person in the thread), status (admin triage), edit (note text/date changed), classification (Jev read the note). Events are app-written and immutable.';
comment on column public.shift_note_replies.data is
  'Event payload: { from, to } for status, { fields } for edit, { signals, model, requested_by } for classification; null for comments.';
comment on table public.shift_note_replies is
  'A shift note''s activity (/admin/shift-notes): comments from admins and the author, plus status changes, edits, and Jev classifications as events. Visible to whoever can see the note, except is_private entries (private comments, classifications), which only admins read.';
