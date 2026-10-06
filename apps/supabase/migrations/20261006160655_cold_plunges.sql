-- Cold plunges become a configured list, each with its own volume.
--
-- The water log has hard-coded two COLDTUB Icebreaker tubs, "left" and
-- "right", at 120 gal each: water_tests.tub carried a check constraint naming
-- them, and every recommended dose was the manual's chart amount for 120 gal.
-- Plunges are now rows admins manage on /admin/water/plunges: a name, the
-- gallons it holds (doses scale from the 120 gal charts by gallons / 120), a
-- display order, and an archived flag. Archiving hides a plunge from the entry
-- form while its history stays in the log.
--
-- Steps:
--   1. create cold_plunges;
--   2. seed the two existing tubs under their current ids, so every
--      water_tests row keeps pointing at the same plunge;
--   3. swap water_tests.tub's check constraint for a foreign key.

-- ---------------------------------------------------------------------------
-- 1. The list
-- ---------------------------------------------------------------------------

create table public.cold_plunges (
  -- slug made from the name at creation ("left", "garden-plunge"); never
  -- changes, because water_tests.tub stores it
  id text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(id) <= 40),
  -- what staff see: "Left", "Garden plunge"
  name text not null check (length(btrim(name)) between 1 and 40),
  -- water volume; recommended doses are the 120 gal chart amounts scaled by
  -- gallons / 120
  gallons numeric(6, 1) not null check (gallons > 0 and gallons <= 2000),
  -- display order in the picker, filter, and setup list (ascending)
  sort_order integer not null default 0,
  -- archived plunges keep their history but are no longer offered for new
  -- entries
  archived boolean not null default false,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index cold_plunges_active_name_idx
  on public.cold_plunges (lower(btrim(name)))
  where not archived;

create trigger cold_plunges_set_updated_at
  before update on public.cold_plunges
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. The tubs already in use
-- ---------------------------------------------------------------------------

insert into public.cold_plunges (id, name, gallons, sort_order, created_by)
values
  ('left', 'Left', 120, 0, 'migration'),
  ('right', 'Right', 120, 1, 'migration');

-- ---------------------------------------------------------------------------
-- 3. Point water_tests at the list
-- ---------------------------------------------------------------------------

alter table public.water_tests drop constraint if exists water_tests_tub_check;

-- No cascade: a plunge with log entries is archived, never deleted (the API
-- refuses the delete), and ids never change.
alter table public.water_tests
  add constraint water_tests_tub_fkey
  foreign key (tub) references public.cold_plunges (id);

comment on column public.water_tests.tub is
  'The plunge this entry is for (public.cold_plunges.id).';

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table public.cold_plunges enable row level security;

-- App access is service-role (bypasses RLS) and gated in-route by
-- requirePage / requireAdmin; these policies follow the convention the other
-- admin tables use. Staff read the list (the water log needs names and
-- gallons); only admins change it.
create policy "authenticated users can select cold plunges"
  on public.cold_plunges for select
  to authenticated
  using (true);

create policy "admins can insert cold plunges"
  on public.cold_plunges for insert
  with check (public.is_admin());

create policy "admins can update cold plunges"
  on public.cold_plunges for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins can delete cold plunges"
  on public.cold_plunges for delete
  using (public.is_admin());

grant all on table public.cold_plunges to service_role;
grant select on table public.cold_plunges to authenticated;
