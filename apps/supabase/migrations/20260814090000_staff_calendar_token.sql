-- Personal calendar feed token. Employees subscribe to their shifts from
-- Google/Apple/Outlook (see apps/integrations /api/schedule/feed.ics), and
-- calendar clients poll that URL with no cookies — so the token in the URL is
-- the entire auth gate.
--
-- A column per person rather than an HMAC of one shared secret: a subscription
-- URL is long-lived and gets pasted into third-party services, so a leaked or
-- stale link has to be revocable for that one employee without breaking
-- everyone else's calendar. Rotating the value is the revoke.
--
-- Nullable with no backfill: minted lazily the first time someone opens the
-- Subscribe panel, so nobody who never subscribes carries a live credential.
alter table public.staff
  add column if not exists calendar_token text unique;

comment on column public.staff.calendar_token is
  'URL-safe random token for the personal shift calendar feed (/api/schedule/feed.ics?t=). Null until the employee first opens the Subscribe panel; rotating it invalidates the old subscription URL. Never returned to anyone but its owner.';
