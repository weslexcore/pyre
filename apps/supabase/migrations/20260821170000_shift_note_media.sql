-- Media for shift notes: photos and video a shift lead attaches to a note to
-- back what they're describing — the short-cycling heater, the leak, the
-- state a room was left in. One row per file, mirroring incident_attachments;
-- objects live in the private shift-note-media bucket and are only ever
-- served through short-lived signed URLs minted by /api/admin/shift-note-media.
--
-- Access model (enforced in the app): everyone who can read the shift-note
-- log can view its media; attaching to a note and removing from it follow the
-- note's own rule — author-or-admin, the same check as editing the text.

create table public.shift_note_attachments (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.shift_notes (id) on delete cascade,
  -- Object key inside the private `shift-note-media` bucket. Never served
  -- directly: the API route mints a short-lived signed URL per view, so media
  -- stays behind the same gate as the log itself.
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  kind text not null check (kind in ('photo', 'video', 'document')),
  -- Session email of whoever attached the file (author or admin).
  uploaded_by text not null,
  created_at timestamptz not null default now()
);

-- The log renders each note's media in upload order.
create index shift_note_attachments_note_idx
  on public.shift_note_attachments (note_id, created_at);

alter table public.shift_note_attachments enable row level security;

-- App access is service-role (bypasses RLS) and gated in-route; these
-- policies are the forward-looking convention the other admin tables follow.
create policy "admins can select shift note attachments"
  on public.shift_note_attachments for select
  using (public.is_admin());

create policy "admins can insert shift note attachments"
  on public.shift_note_attachments for insert
  with check (public.is_admin());

create policy "admins can delete shift note attachments"
  on public.shift_note_attachments for delete
  using (public.is_admin());

-- Private bucket for shift-note media. Same shape and limits as
-- incident-media: staff phone photos and clips, 50 MB ceiling per file, reads
-- only via signed URLs from the gated API route.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'shift-note-media',
  'shift-note-media',
  false,
  52428800,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif',
    'video/mp4', 'video/quicktime', 'video/webm',
    'application/pdf'
  ]
)
on conflict (id) do nothing;

comment on table public.shift_note_attachments is
  'Photos/video/documents attached to shift notes (/admin/shift-notes). Objects live in the private shift-note-media bucket and are served via signed URLs minted by /api/admin/shift-note-media.';
