-- Cold-tub water testing log for the two COLDTUB Icebreaker tubs ("left" and
-- "right", 120 gal each), written by staff from the /admin/water page in
-- apps/integrations. Each row is one visit to a tub: a routine test panel, a
-- weekly shock treatment, or a drain/refill event, plus whatever chemicals
-- were actually added.
--
-- Readings carry sanity bounds only — target ranges and dosing charts live in
-- apps/integrations/src/lib/water/ so ops-manual changes don't need a
-- migration.

create table public.water_tests (
  id uuid primary key default gen_random_uuid(),
  -- which tub, as labeled on the deck
  tub text not null check (tub in ('left', 'right')),
  -- 'test' = routine reading panel; 'shock' = weekly sanitizer + oxidizer
  -- treatment (tub closed); 'refill' = drain/dilute or full drain-and-refill
  entry_type text not null default 'test'
    check (entry_type in ('test', 'shock', 'refill')),
  -- readings in the order they're tested (TA -> pH -> chlorine -> salt);
  -- nullable because shock/refill entries may not include a full panel
  ta_ppm numeric check (ta_ppm >= 0 and ta_ppm <= 1000),
  ph numeric check (ph >= 0 and ph <= 14),
  chlorine_ppm numeric check (chlorine_ppm >= 0 and chlorine_ppm <= 50),
  salt_ppm numeric check (salt_ppm >= 0 and salt_ppm <= 20000),
  -- chemicals actually added with this entry, e.g.
  -- [{"chemical": "Cold Water Balance", "grams": 23,
  --   "reason": "TA 70 ppm is below the 80-120 target", "recommended_grams": 23}]
  -- grams is what went in the water; recommended_grams is what the chart said,
  -- so deviations stay auditable
  doses jsonb not null default '[]'::jsonb check (jsonb_typeof(doses) = 'array'),
  -- free-text: "tub closed, retest in 30 min", refill details, etc.
  notes text,
  -- Momence email of the staff member who logged the entry
  recorded_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The log view: newest first, optionally filtered to one tub.
create index water_tests_created_idx
  on public.water_tests (created_at desc);

create index water_tests_tub_created_idx
  on public.water_tests (tub, created_at desc);

alter table public.water_tests enable row level security;

-- App access is service-role (bypasses RLS); this policy is forward-looking
-- convention, same as the other tables.
create policy "admins can select water tests"
  on public.water_tests for select
  to authenticated
  using (public.is_admin());

create trigger water_tests_set_updated_at
  before update on public.water_tests
  for each row execute function public.set_updated_at();
