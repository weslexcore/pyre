-- A form's own title, and an image behind it.
--
-- Two things the board_forms migration did not have when it shipped: the
-- heading on the form page was the board's name, and the page was the
-- plain dark shell. Now a form can be headed however the manager likes
-- (it starts as the board's name, and blank falls back to it, so a form
-- can never be headed nothing), and can carry an image behind the
-- questions.
--
-- Written to be safe against a database that already has either half —
-- `if not exists` and `on conflict do nothing` — because a local copy was
-- brought up to date by hand before this file existed.

begin;

alter table public.board_forms
  add column if not exists title text not null default ''
    check (char_length(title) <= 120);

comment on column public.board_forms.title is
  'The heading on the form page; blank means the board''s name.';

-- An image behind the form, as its object key in the board-form-media
-- bucket; null is the plain dark page.
alter table public.board_forms
  add column if not exists background_path text
    check (background_path is null or char_length(background_path) <= 300);

comment on column public.board_forms.background_path is
  'Object key in the board-form-media bucket of the image shown behind the form; null for none.';

-- A public bucket, unlike the incident, shift-note, and lost-and-found
-- media: the image is decoration on a page that may itself be public, and a
-- signed URL would expire under a form somebody bookmarked. Images only,
-- and small — a background, not an archive. Writes still go through the
-- gated API route, which is also what keeps one image per form.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'board-form-media',
  'board-form-media',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

commit;
