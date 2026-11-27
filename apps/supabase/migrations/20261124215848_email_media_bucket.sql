-- Photos staff upload for email: a custom background behind the header, or
-- an image block in the body, on journeys and newsletters
-- (/api/admin/email-media in apps/integrations).
--
-- Its own bucket, and public: an email is read in someone's inbox for months
-- after it was sent, so its images need plain, permanent addresses (a signed
-- link would expire under it). Nothing is ever deleted from here for the same
-- reason: a sent email can't be changed to stop using an image.
--
-- Uploads go through the gated API route with the service role, so the
-- bucket needs no insert policy; public buckets serve reads without one.
-- Images only, in the formats every mail client shows (no WebP: desktop
-- Outlook can't), and at most 5 MB, since a heavy image slows every open.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'email-media',
  'email-media',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/gif']
)
on conflict (id) do nothing;
