-- Video walkthroughs for SOPs: an admin records the part of a process that
-- reads badly as text (banking the stove, threading the hose, the Momence
-- check-in screen), uploads it once, and any SOP embeds it from its markdown:
--
--   ![Banking the stove](/api/admin/sop-videos/<id>)
--
-- An image reference whose target is a library video renders as a player
-- (components/admin/SopMarkdown). Anything else stays an image. A plain link
-- to the same path opens the video on its own.
--
-- Hosted entirely in this app's own Supabase storage. Nothing is embedded
-- from YouTube or Vimeo. Objects live in the private sop-videos bucket and
-- are only ever served through short-lived signed URLs minted by
-- /api/admin/sop-videos/<id>, behind the /admin/sops page grant.
--
-- Uploads go straight from the browser to storage on a signed upload URL,
-- because walkthroughs are far bigger than a serverless function's request
-- body limit. The row is written first with status 'uploading', then
-- flipped to 'ready' once the route has seen the object land. A row still
-- 'uploading' after a day was an abandoned upload, and the library route
-- clears it (and any partial object) the next time it lists videos.
--
-- Only admins upload, rename and delete. Anyone who can open the SOP
-- library can watch.

create table public.sop_videos (
  id uuid primary key default gen_random_uuid(),
  -- Shown under the player and in the library picker; the default alt text
  -- when the video is inserted into a document.
  title text not null check (char_length(title) between 1 and 200),
  -- Object key inside the private `sop-videos` bucket. Never served
  -- directly: the API route mints a short-lived signed URL per view.
  storage_path text not null unique,
  -- Original name of the uploaded file, kept for downloads.
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null check (mime_type in ('video/mp4', 'video/webm', 'video/quicktime')),
  size_bytes bigint not null check (size_bytes > 0),
  -- 'uploading' until the browser's direct upload is confirmed in storage.
  status text not null default 'uploading' check (status in ('uploading', 'ready')),
  -- Session email of the admin who uploaded it.
  uploaded_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger sop_videos_set_updated_at
  before update on public.sop_videos
  for each row execute function public.set_updated_at();

-- The library lists newest first; the stale-upload cleanup scans by age.
create index sop_videos_created_idx on public.sop_videos (created_at desc);
create index sop_videos_uploading_idx
  on public.sop_videos (created_at)
  where status = 'uploading';

alter table public.sop_videos enable row level security;

-- App access is service-role (bypasses RLS) and gated in-route; these
-- policies are the convention the other dashboard tables follow.
create policy "admins can select sop videos"
  on public.sop_videos for select
  using (public.is_admin());

create policy "admins can insert sop videos"
  on public.sop_videos for insert
  with check (public.is_admin());

create policy "admins can update sop videos"
  on public.sop_videos for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins can delete sop videos"
  on public.sop_videos for delete
  using (public.is_admin());

comment on table public.sop_videos is
  'Video walkthroughs embedded in SOP markdown as ![title](/api/admin/sop-videos/<id>). Objects live in the private sop-videos bucket and are served via signed URLs minted by /api/admin/sop-videos/<id>.';
comment on column public.sop_videos.status is
  '''uploading'' while the browser uploads straight to storage; ''ready'' once the route has confirmed the object exists.';

-- Private bucket for the walkthroughs. 500 MB per file: a few minutes of
-- phone video at 1080p. The project's global upload limit (Storage settings)
-- must be at least this for the largest files to go through.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sop-videos',
  'sop-videos',
  false,
  524288000,
  array['video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do nothing;
