-- Shift notes grow a conversation and a status. Until now a note was one-way:
-- staff wrote what happened, admins read it, and nothing recorded whether an
-- admin saw it, acted on a request in it, or answered feedback. Two additions:
--
--   1. A status on every note — open (nobody has triaged it), todo (an admin
--      owns a follow-up), resolved (done) — so requests and feedback get
--      tracked to completion on /admin/shift-notes. Only admins change it;
--      the author sees it on their own notes.
--   2. A reply thread per note (shift_note_replies): admins respond in
--      context, and the note's author can reply back, so the two can talk
--      on the note itself. Replies are visible to whoever can see the note
--      (admins, plus the author for their own), except replies an admin
--      marks private, which only admins read.
--
-- Access is enforced in the app (lib/shift-notes/access); the RLS policies
-- below stay admin-only as the forward-looking convention the other shift
-- note tables follow.

-- Triage state of the note. Fresh notes are open; only admins move them.
alter table public.shift_notes
  add column status text not null default 'open'
    check (status in ('open', 'todo', 'resolved')),
  -- Session email of the admin who last set the status, and when. Null
  -- while the note has never been triaged; the pair travels together.
  add column status_by text,
  add column status_at timestamptz,
  add constraint shift_notes_status_pair_check
    check ((status_by is null) = (status_at is null));

-- The page filters the log by status, newest shift first.
create index shift_notes_status_idx on public.shift_notes (status, note_date desc);

comment on table public.shift_notes is
  'Shift notes about how a shift went (/admin/shift-notes): free-text entries keyed by shift date, attributed to the session email. Anyone active on the roster may write one; admins read every note, everyone else only their own. Admins triage each note (open / todo / resolved) and can reply; see shift_note_replies.';

-- One reply in a note's thread, from an admin or the note's author.
create table public.shift_note_replies (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.shift_notes (id) on delete cascade,
  body text not null check (length(btrim(body)) > 0 and char_length(body) <= 4000),
  -- Email from the session, never the request body.
  author_email text not null check (char_length(author_email) between 3 and 320),
  -- Admins-only reply: hidden from the note's author. Only an admin may set
  -- it (the route forces false for everyone else).
  is_private boolean not null default false,
  -- Session email of the last editor (reply author or admin); null until edited.
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A thread renders in writing order under its note.
create index shift_note_replies_note_idx
  on public.shift_note_replies (note_id, created_at);

create trigger shift_note_replies_set_updated_at
  before update on public.shift_note_replies
  for each row execute function public.set_updated_at();

alter table public.shift_note_replies enable row level security;

-- App access is service-role (bypasses RLS) and gated in-route; these
-- policies are the forward-looking convention the other admin tables follow.
create policy "admins can select shift note replies"
  on public.shift_note_replies for select
  using (public.is_admin());

create policy "admins can insert shift note replies"
  on public.shift_note_replies for insert
  with check (public.is_admin());

create policy "admins can update shift note replies"
  on public.shift_note_replies for update
  using (public.is_admin());

create policy "admins can delete shift note replies"
  on public.shift_note_replies for delete
  using (public.is_admin());

comment on table public.shift_note_replies is
  'Reply thread on a shift note (/admin/shift-notes): admins respond in context and the author replies back. Visible to whoever can see the note, except is_private replies, which only admins read.';
