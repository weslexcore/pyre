-- Stipend hours: recurring weekly hours paid for off-schedule work (e.g.
-- "inventory & towel ordering, 1h/week"), tracked per person on the hours
-- report alongside scheduled shift hours and priced at the same pay_rate.
-- Managed from /admin/users (recurring stipends, next to pay rates) and
-- /admin/schedule/hours (per-week adjustments); admin only.
--
-- Two tables on purpose:
--   staff_stipends    the recurring agreement, effective-dated by week so
--                     editing or ending a stipend never rewrites weeks that
--                     were already paid out (the hours report recomputes past
--                     pay periods from this data).
--   stipend_overrides one-off per-week replacements ("big restock week: 2.5h",
--                     "skipped this week: 0h"). An override REPLACES the
--                     default hours for that week — 0 means skipped.
--
-- Weeks are identified by their Monday (YYYY-MM-DD), matching the Mon–Sun
-- weeks of the hours rollup in packages/schedule-core.

create table public.staff_stipends (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id) on delete cascade,
  -- what the stipend is for, shown on the hours report ("Inventory & towels")
  label text not null check (char_length(label) between 1 and 80),
  -- tenth-hour steps like target_hours_per_week; a weekly stipend is small
  hours_per_week numeric(4,1) not null
    check (hours_per_week > 0 and hours_per_week <= 40),
  -- first Monday-start week this stipend pays
  effective_from date not null check (extract(isodow from effective_from) = 1),
  -- last Monday-start week this stipend pays; null = open-ended. Ending a
  -- stipend sets this instead of deleting the row, preserving paid history.
  effective_until date check (
    effective_until is null
    or (extract(isodow from effective_until) = 1 and effective_until >= effective_from)
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index staff_stipends_staff_idx on public.staff_stipends (staff_id);

create table public.stipend_overrides (
  id uuid primary key default gen_random_uuid(),
  stipend_id uuid not null references public.staff_stipends (id) on delete cascade,
  -- Monday of the week being overridden
  week_start date not null check (extract(isodow from week_start) = 1),
  -- replaces the stipend's hours_per_week for this week; 0 = skipped
  hours numeric(4,1) not null check (hours >= 0 and hours <= 40),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stipend_id, week_start)
);

-- App access is service-role (bypasses RLS); enabling RLS with admin-select
-- policies is forward-looking convention, same as the other schedule tables.
alter table public.staff_stipends enable row level security;
alter table public.stipend_overrides enable row level security;

create policy "admins can select staff stipends"
  on public.staff_stipends for select to authenticated using (public.is_admin());
create policy "admins can select stipend overrides"
  on public.stipend_overrides for select to authenticated using (public.is_admin());

create trigger staff_stipends_set_updated_at
  before update on public.staff_stipends
  for each row execute function public.set_updated_at();
create trigger stipend_overrides_set_updated_at
  before update on public.stipend_overrides
  for each row execute function public.set_updated_at();

comment on table public.staff_stipends is
  'Recurring weekly stipend hours for off-schedule work, paid at staff.pay_rate. Effective-dated by Monday week so past pay periods never change.';
comment on table public.stipend_overrides is
  'Per-week replacement for a stipend''s default hours (0 = skipped that week). One row per (stipend, Monday week).';
