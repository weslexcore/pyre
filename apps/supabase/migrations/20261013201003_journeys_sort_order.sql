-- The order journeys are listed in on /admin/journeys.
--
-- Admins drag journeys into the order that makes sense to them (e.g. the
-- customer lifecycle: welcome, intro offer, win-back). One shared order for
-- everyone, lowest first; ties fall back to the name. Existing journeys start
-- in name order. New journeys are added at the end by the app.

alter table public.journeys
  add column sort_order integer not null default 0;

update public.journeys j
set sort_order = ordered.position
from (
  select id, row_number() over (order by name) as position
  from public.journeys
) as ordered
where j.id = ordered.id;
