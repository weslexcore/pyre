-- Schedule lint rules.
--
-- The schedule lint (apps/integrations, lib/schedule-lint) checks the Momence
-- schedule against a set of rules and emails the admins what to cancel or fix.
-- The rules ship in code with sensible defaults; this table is what the
-- admins have changed about them on /admin/schedule-lint:
--
--   * a built-in rule (special-event-overlap, untagged, draft-soon, duplicate,
--     capacity-outlier, horizon-short) gets a row keyed by its kind only once
--     someone disables it or tunes a setting — no row means "defaults, on";
--   * a custom rule (opening-hours, required-tag, expected-capacity) is a
--     uuid-keyed instance of a rule template, with its own label and settings,
--     and there can be as many of one kind as the admins like.
--
-- `params` is validated against the rule kind's fields by
-- lib/schedule-lint/registry.ts on every write and every read; a row that no
-- longer validates is skipped with a warning, never fatal. Nothing else about
-- a lint run is stored — findings are recomputed from Momence each time.

create table public.schedule_lint_rules (
  -- The rule kind for a built-in override; gen_random_uuid() for a custom rule.
  id text primary key,
  -- Which rule this is (see DEFINITIONS in lib/schedule-lint/rules/index.ts).
  kind text not null,
  -- Shown on the page and in the email; defaults to the kind's title.
  label text not null,
  enabled boolean not null default true,
  -- The rule's settings, shaped by the kind's `fields`.
  params jsonb not null default '{}'::jsonb
    check (jsonb_typeof(params) = 'object'),
  -- Dashboard email of whoever last saved it.
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The page lists custom rules in creation order.
create index schedule_lint_rules_created_idx
  on public.schedule_lint_rules (created_at);

-- App access is service-role (bypasses RLS) and gated in-route by
-- requirePage; these policies are the forward-looking convention, same as the
-- other admin-tool tables.
alter table public.schedule_lint_rules enable row level security;

create policy "admins can select schedule lint rules"
  on public.schedule_lint_rules for select
  using (public.is_admin());

create policy "admins can insert schedule lint rules"
  on public.schedule_lint_rules for insert
  with check (public.is_admin());

create policy "admins can update schedule lint rules"
  on public.schedule_lint_rules for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins can delete schedule lint rules"
  on public.schedule_lint_rules for delete
  using (public.is_admin());

create trigger schedule_lint_rules_set_updated_at
  before update on public.schedule_lint_rules
  for each row execute function public.set_updated_at();
