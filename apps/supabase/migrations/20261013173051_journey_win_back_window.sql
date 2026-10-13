-- Give the seeded win-back journey an outer edge.
--
-- journey_builder seeded win-back-30-days with "not seen for 30 days" and no
-- upper bound, so switching it on would have emailed every customer who ever
-- lapsed — people last seen years ago included — in one burst. Audience
-- journeys now accept maxInactiveDays ("...but seen within N days"); this sets
-- the draft to 30-60 days away, so it catches people as they drift rather
-- than the whole backlog.
--
-- Only touches the untouched seed (revision 1): if an admin has already edited
-- the journey, their version stands.

update public.journeys
set
  definition = jsonb_set(definition, '{trigger,maxInactiveDays}', '60'::jsonb),
  revision = revision + 1,
  updated_by = 'migration'
where id = 'win-back-30-days'
  and revision = 1;

insert into public.journey_revisions (journey_id, revision, name, definition, edited_by, note)
select id, revision, name, definition, 'migration', 'Only customers last seen 30-60 days ago'
from public.journeys
where id = 'win-back-30-days'
  and revision = 2
  and updated_by = 'migration'
on conflict (journey_id, revision) do nothing;
