-- Shift notes: a running log where the person leading a shift writes down how
-- it went — anything the next crew or the admins should know: what happened,
-- what broke, guest moments worth passing on, feedback for the team. One row
-- per note, attributed to the session email like the other SOP-side tables.
-- Notes are keyed by the shift date (local wall-clock America/New_York, the
-- same convention as the schedule tables) rather than by a shifts row, so a
-- note can be written even when the schedule board holds no synced shift for
-- that day.
--
-- Access model (enforced in the app, /admin/shift-notes): the page is visible
-- to admins, to everyone on the roster flagged is_shift_lead (an implicit
-- page grant in lib/auth/access), and to anyone an admin explicitly grants
-- the page from /admin/users. Everyone who can see the page reads the whole
-- log and may add notes; editing and deleting a note is author-or-admin.

create table public.shift_notes (
  id uuid primary key default gen_random_uuid(),
  -- The shift being described (local wall-clock date, America/New_York).
  note_date date not null,
  body text not null check (length(btrim(body)) > 0 and char_length(body) <= 8000),
  -- Email from the Momence session, never the request body.
  author_email text not null check (char_length(author_email) between 3 and 320),
  -- Session email of the last editor (author or admin); null until edited.
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The page lists newest shifts first, notes within a shift in writing order.
create index shift_notes_date_idx on public.shift_notes (note_date desc, created_at);

create trigger shift_notes_set_updated_at
  before update on public.shift_notes
  for each row execute function public.set_updated_at();

alter table public.shift_notes enable row level security;

-- App access is service-role (bypasses RLS); forward-looking convention like
-- the other sops tables.
create policy "admins can select shift notes"
  on public.shift_notes for select
  using (public.is_admin());

create policy "admins can insert shift notes"
  on public.shift_notes for insert
  with check (public.is_admin());

create policy "admins can update shift notes"
  on public.shift_notes for update
  using (public.is_admin());

create policy "admins can delete shift notes"
  on public.shift_notes for delete
  using (public.is_admin());

comment on table public.shift_notes is
  'Shift-lead notes about how a shift went (/admin/shift-notes): free-text entries keyed by shift date, attributed to the session email.';
