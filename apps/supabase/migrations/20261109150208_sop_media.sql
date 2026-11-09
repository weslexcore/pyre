-- Images and video walkthroughs for SOPs. An admin uploads a photo of the
-- part of a process that reads badly as text (how the stove should look
-- when it's banked, where the breaker is) or records a walkthrough of it,
-- uploads it once, and any SOP embeds it from its markdown:
--
--   ![Banked stove](/api/admin/sop-images/<id>)
--   ![Banking the stove](/api/admin/sop-videos/<id>)
--
-- An image reference to a library image renders as that image, and one to
-- a library video renders as a player (components/admin/SopMarkdown). A
-- plain link to either path opens the file on its own.
--
-- Everything is stored in this app's own Supabase storage. Nothing is
-- embedded from YouTube, Vimeo or an image host. Objects live in the private
-- sop-media bucket and are only ever served through short-lived signed URLs
-- minted by those two routes, behind the /admin/sops page grant.
--
-- Uploads go straight from the browser to storage on a signed upload URL,
-- because walkthroughs are far bigger than a serverless function's request
-- body limit. The row is written first with status 'uploading', then
-- flipped to 'ready' once the route has seen the object land. A row still
-- 'uploading' after a day was an abandoned upload, and the library route
-- clears it (and any partial object) the next time it lists the library.
--
-- Only admins upload, rename and delete. Anyone who can open the SOP
-- library can view.

create table public.sop_media (
  id uuid primary key default gen_random_uuid(),
  -- 'image' or 'video'; decides the route that serves it and how it renders.
  kind text not null check (kind in ('image', 'video')),
  -- Shown in the library picker; the default alt text (and, for a video,
  -- the caption under the player) when it is inserted into a document.
  title text not null check (char_length(title) between 1 and 200),
  -- Object key inside the private `sop-media` bucket. Never served
  -- directly: the API routes mint a short-lived signed URL per view.
  storage_path text not null unique,
  -- Original name of the uploaded file, kept for downloads.
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  -- 'uploading' until the browser's direct upload is confirmed in storage.
  status text not null default 'uploading' check (status in ('uploading', 'ready')),
  -- Session email of the admin who uploaded it.
  uploaded_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The file type has to match the kind it is filed as.
  constraint sop_media_mime_matches_kind check (
    (kind = 'image' and mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif'))
    or (kind = 'video' and mime_type in ('video/mp4', 'video/webm', 'video/quicktime'))
  )
);

create trigger sop_media_set_updated_at
  before update on public.sop_media
  for each row execute function public.set_updated_at();

-- The library lists newest first; the stale-upload cleanup scans by age.
create index sop_media_created_idx on public.sop_media (created_at desc);
create index sop_media_uploading_idx
  on public.sop_media (created_at)
  where status = 'uploading';

alter table public.sop_media enable row level security;

-- App access is service-role (bypasses RLS) and gated in-route; these
-- policies are the convention the other dashboard tables follow.
create policy "admins can select sop media"
  on public.sop_media for select
  using (public.is_admin());

create policy "admins can insert sop media"
  on public.sop_media for insert
  with check (public.is_admin());

create policy "admins can update sop media"
  on public.sop_media for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins can delete sop media"
  on public.sop_media for delete
  using (public.is_admin());

comment on table public.sop_media is
  'Images and videos embedded in SOP markdown as ![title](/api/admin/sop-images/<id>) or ![title](/api/admin/sop-videos/<id>). Objects live in the private sop-media bucket and are served via signed URLs minted by those routes.';
comment on column public.sop_media.status is
  '''uploading'' while the browser uploads straight to storage; ''ready'' once the route has confirmed the object exists.';

-- Private bucket for SOP media. 500 MB per file is the video ceiling (a few
-- minutes of phone video at 1080p). Images are held to 20 MB in the app. The
-- project's global upload limit (Storage settings) must be at least as large
-- for the biggest files to go through.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sop-media',
  'sop-media',
  false,
  524288000,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime'
  ]
)
on conflict (id) do nothing;
