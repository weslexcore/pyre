-- Emergencies and reasons on sub requests.
--
-- 1. time_off.is_emergency — the person can't work it (illness, family
--    emergency). Shown on the Availability sheet beside the note. Anything
--    short of an emergency isn't marked; false on every existing entry.
--
-- 2. sub_requests.reason / is_emergency — what the requester gave when asking
--    for a sub. The reason also becomes the note on the time-off entry the
--    request logs, and the emergency flag is copied onto it; both are
--    snapshotted here (like the window and duties) so the request keeps them
--    if that entry is edited or removed. The reason is manager-side only —
--    teammates asked to cover see that it's an emergency, not why.

alter table public.time_off
  add column is_emergency boolean not null default false;

comment on column public.time_off.is_emergency is
  'The person can''t work this time (illness, family emergency). False = not marked.';

alter table public.sub_requests
  add column reason text,
  add column is_emergency boolean not null default false;

comment on column public.sub_requests.reason is
  'Optional reason from the requester; copied into the time-off note. Shown to managers only.';
comment on column public.sub_requests.is_emergency is
  'The requester marked it an emergency; copied onto the time-off entry. Shown to everyone.';
