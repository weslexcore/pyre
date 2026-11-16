-- Staff avatars. Everyone on the roster shows up as a round badge wherever
-- the dashboard names a person (shift notes, messages, boards, the
-- schedule...). By default the badge is their first initial on a colour
-- picked at random when the row is made. Once they upload a photo from
-- /admin/account, the photo takes over.
--
-- The photo is stored in the private `staff-avatars` bucket. It is only
-- served through /api/admin/staff-avatar, which any signed-in dashboard user
-- may read. The browser crops the photo to a small square before uploading
-- it, so a stored avatar is a few dozen KB.

alter table public.staff
  -- Object key inside the `staff-avatars` bucket, or null for the initials
  -- badge. A new upload gets a new key, so the key doubles as the cache
  -- buster in the avatar URL.
  add column avatar_path text,
  -- Palette key for the initials badge (the colours themselves live in code,
  -- components/admin/StaffAvatar). Volatile default: each existing row gets
  -- its own random pick when the column is added, and so does each new row.
  add column avatar_color text not null default (
    (array['ember', 'gold', 'sage', 'sky', 'plum', 'rose', 'teal', 'sand'])[1 + floor(random() * 8)::int]
  );

-- The bucket behind avatar_path. Private: the app reads and writes it with
-- the service role, so it needs no storage policies.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'staff-avatars',
  'staff-avatars',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;
