-- Replace the three-level severity with a single emergency flag.
--
-- 20261006172119 first shipped as time_off_severity (time_off.severity,
-- sub_requests.reason / severity) and was applied to production. The file was
-- later swapped for time_off_emergency under the same timestamp, so databases
-- that already ran it never got is_emergency. This migration brings both
-- histories to the same end state:
--
--   time_off.is_emergency      boolean not null default false
--   sub_requests.reason        text (unchanged; present in both versions)
--   sub_requests.is_emergency  boolean not null default false
--   no severity columns
--
-- Every statement is guarded, so it is a no-op where the emergency version
-- already ran. A 'high' severity (emergency; can't work it) becomes
-- is_emergency = true; 'low' / 'medium' / null become false.

alter table public.time_off
  add column if not exists is_emergency boolean not null default false;

alter table public.sub_requests
  add column if not exists reason text,
  add column if not exists is_emergency boolean not null default false;

-- carry 'high' severities over before dropping the column
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'time_off' and column_name = 'severity'
  ) then
    update public.time_off set is_emergency = true where severity = 'high';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sub_requests' and column_name = 'severity'
  ) then
    update public.sub_requests set is_emergency = true where severity = 'high';
  end if;
end
$$;

alter table public.time_off drop column if exists severity;
alter table public.sub_requests drop column if exists severity;

comment on column public.time_off.is_emergency is
  'The person can''t work this time (illness, family emergency). False = not marked.';
comment on column public.sub_requests.reason is
  'Optional reason from the requester; copied into the time-off note. Shown to managers only.';
comment on column public.sub_requests.is_emergency is
  'The requester marked it an emergency; copied onto the time-off entry. Shown to everyone.';

-- make postgrest pick up the new columns right away
notify pgrst, 'reload schema';
