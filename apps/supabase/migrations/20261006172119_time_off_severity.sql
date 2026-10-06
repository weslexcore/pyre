-- How badly someone needs time off, and why, on sub requests.
--
-- 1. time_off.severity — optional: 'low' (would prefer it off; can still
--    work it if nobody covers), 'medium' (needs it off), 'high' (emergency;
--    can't work it). Shown on the Availability sheet beside the note. Null =
--    not given, which is every entry made before this migration.
--
-- 2. sub_requests.reason / severity — what the requester gave when asking for
--    a sub. The reason also becomes the note on the time-off entry the
--    request logs; both are snapshotted here (like the window and duties) so
--    the request keeps them if that entry is edited or removed. The reason is
--    manager-side only — teammates asked to cover see the severity, not why.

alter table public.time_off
  add column severity text check (severity in ('low', 'medium', 'high'));

comment on column public.time_off.severity is
  'How badly the person needs this time off: low (can work it if nobody covers), medium (needs it off), high (emergency). Null = not given.';

alter table public.sub_requests
  add column reason text,
  add column severity text check (severity in ('low', 'medium', 'high'));

comment on column public.sub_requests.reason is
  'Optional reason from the requester; copied into the time-off note. Shown to managers only.';
comment on column public.sub_requests.severity is
  'Optional severity from the requester (low / medium / high); copied onto the time-off entry.';
