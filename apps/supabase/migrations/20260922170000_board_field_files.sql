-- A board field kind for files: a signed contract on a rental lead, the
-- floor plan a caterer sent, the photo behind a maintenance task. A card
-- answers a `files` field with one to many attachments.
--
-- The answer on the card stays what every other answer is — a value under
-- the field's key in board_cards.properties — and holds the attachment ids,
-- in the order they were added. The bytes and their names live in
-- board_attachments, one row per file, mirroring shift_note_attachments:
--
--   * board_id  — the board the file was uploaded for. Set from the first
--                 byte, so a file can be reached (and cleaned up) by board
--                 before any card names it.
--   * card_id   — the card whose answer lists it; null while *staged*. The
--                 drawer and the form both upload the moment a file is
--                 picked, before the answer is saved, and the card claims
--                 its staged rows when the answer that names them is
--                 written. A staged row nobody claimed within a day is an
--                 abandoned pick, and the hourly sweep removes it.
--   * field_key — which of the board's fields it answers, so a file is
--                 never counted against the wrong field's limit.
--
-- Objects live in the private board-media bucket and are only ever served
-- through short-lived signed URLs minted by /api/admin/board-media, behind
-- the same grant as the board itself. Nothing on a public form page can read
-- a file back; it can only add one to the answer it is about to send.

begin;

alter table public.board_fields
  drop constraint board_fields_kind_check;
alter table public.board_fields
  add constraint board_fields_kind_check
  check (kind in ('text', 'number', 'yes_no', 'choice', 'multi_choice', 'date', 'time', 'time_range', 'files'));

create table public.board_attachments (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards (id) on delete cascade,
  -- Owning card; null while staged (uploaded before the answer naming it was saved).
  card_id uuid references public.board_cards (id) on delete cascade,
  -- The `files` field this answers, by key (board_fields.key is permanent).
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  -- Object key inside the private `board-media` bucket. Never served
  -- directly: the API route mints a short-lived signed URL per view.
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  kind text not null check (kind in ('photo', 'video', 'document')),
  -- Session email of whoever uploaded it, or 'form' for a public submission.
  uploaded_by text not null,
  created_at timestamptz not null default now()
);

-- The drawer lists a card's files in upload order.
create index board_attachments_card_idx
  on public.board_attachments (card_id, created_at);
-- The sweep finds staged rows by age; the upload route counts them per board.
create index board_attachments_staged_idx
  on public.board_attachments (board_id, created_at)
  where card_id is null;

alter table public.board_attachments enable row level security;

-- App access is service-role (bypasses RLS) and gated in-route; these are
-- the convention the other board tables follow.
create policy "admins can select board attachments"
  on public.board_attachments for select using (public.is_admin());
create policy "admins can insert board attachments"
  on public.board_attachments for insert with check (public.is_admin());
create policy "admins can update board attachments"
  on public.board_attachments for update using (public.is_admin()) with check (public.is_admin());
create policy "admins can delete board attachments"
  on public.board_attachments for delete using (public.is_admin());

comment on table public.board_attachments is
  'Files answering a board''s `files` fields. Objects live in the private board-media bucket and are served via signed URLs minted by /api/admin/board-media. card_id is null while staged.';
comment on column public.board_attachments.card_id is
  'The card whose answer lists this file; null while staged (uploaded before the answer was saved).';
comment on column public.board_attachments.field_key is
  'The board_fields.key of the files field this answers.';

-- Private bucket, the same shape and limits as shift-note-media: staff
-- phone photos, clips, and PDFs, 50 MB ceiling per file, reads only via
-- signed URLs from the gated API route. Private even for a public form's
-- uploads — a stranger sends a file in; nobody outside the board reads one.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'board-media',
  'board-media',
  false,
  52428800,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif',
    'video/mp4', 'video/quicktime', 'video/webm',
    'application/pdf'
  ]
)
on conflict (id) do nothing;

commit;
