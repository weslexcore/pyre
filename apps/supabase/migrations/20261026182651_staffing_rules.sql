-- Staffing rules: how many people a shift needs.
--
-- The Momence sync gave every shift it created staff_needed = 2, and the only
-- way to change that was by hand, shift by shift. Admins now keep an ordered
-- list of rules on the schedule board's Settings panel ("Thu/Fri mornings
-- need 1", "Saturday afternoons with a Guided session need 3"). The first
-- enabled rule whose conditions all hold sets the count; an empty condition
-- matches anything; a shift no rule matches keeps the old default of 2.
-- Matching lives in @pyre/schedule-core (staffing.ts).
--
-- The sync applies the rules to the shifts it creates and re-applies them to
-- the shifts it already tracks, except where an admin set the count by hand
-- (shifts.staff_needed_manual).

-- 1. The rules ---------------------------------------------------------------

create table public.staffing_rules (
  -- Client-generated (crypto.randomUUID) so the editor can save the whole
  -- ordered list in one request.
  id text primary key,
  -- Evaluation order: lowest first; the first match wins.
  position integer not null,
  -- The admin's name for the rule, e.g. "Weekday mornings". May be empty.
  name text not null default '',
  enabled boolean not null default true,
  -- Conditions. Empty array / null = matches anything.
  -- Days of the week, 0 = Sunday ... 6 = Saturday.
  days smallint[] not null default '{}'
    check (days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  -- Shift labels (Morning, Afternoon, Evening, Day), case-insensitive.
  shift_labels text[] not null default '{}',
  -- The shift starts at or after starts_from and before starts_before.
  starts_from time,
  starts_before time,
  -- Some covered session's title contains this text, case-insensitive.
  title_contains text,
  -- Some covered session carries one of these Momence tags.
  tags text[] not null default '{}',
  -- The head count a matching shift gets (same bounds as shifts.staff_needed).
  staff_needed smallint not null check (staff_needed between 0 and 20),
  -- Dashboard email of whoever last saved the list.
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staffing_rules_start_window_check
    check (starts_from is null or starts_before is null or starts_before > starts_from)
);

comment on table public.staffing_rules is
  'Ordered rules for how many people a shift needs; first enabled match wins. Applied by the Momence sync (lib/schedule/sync.ts) via @pyre/schedule-core staffing.ts.';

create index staffing_rules_position_idx on public.staffing_rules (position);

-- App access is service-role (bypasses RLS), gated in-route by requireAdmin;
-- these policies are the forward-looking convention, same as the other
-- schedule tables.
alter table public.staffing_rules enable row level security;

create policy "admins can select staffing rules"
  on public.staffing_rules for select
  using (public.is_admin());

create policy "admins can insert staffing rules"
  on public.staffing_rules for insert
  with check (public.is_admin());

create policy "admins can update staffing rules"
  on public.staffing_rules for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins can delete staffing rules"
  on public.staffing_rules for delete
  using (public.is_admin());

create trigger staffing_rules_set_updated_at
  before update on public.staffing_rules
  for each row execute function public.set_updated_at();

-- 2. Hand-set head counts ------------------------------------------------------

alter table public.shifts
  add column staff_needed_manual boolean not null default false;

comment on column public.shifts.staff_needed_manual is
  'Set when an admin chose this shift''s staff_needed by hand; the sync''s staffing rules leave it alone. Cleared from the shift editor to hand it back to the rules.';

-- Any Momence shift whose count isn't the old default was set by hand — keep
-- it, so turning the rules on never overwrites a deliberate number.
update public.shifts
  set staff_needed_manual = true
  where source = 'momence' and staff_needed <> 2;

-- RLS for the new column: covered by the existing shifts policies.
