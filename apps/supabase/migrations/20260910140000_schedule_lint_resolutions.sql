-- Schedule lint resolutions: findings an admin has looked at and called fine.
--
-- Switching a rule off silences everything it would ever find. This table is
-- the smaller instrument: one row per finding an admin has marked resolved on
-- /admin/schedule-lint, so that one 8pm slot with no two-hour twin stops
-- appearing in the email while the rest of the rule keeps working.
--
-- The primary key is the finding's own key (see Finding.key in
-- lib/schedule-lint/types.ts), which is built to be stable across runs for the
-- same underlying problem. It names one occurrence — a specific session, a
-- specific start time — so resolving next Thursday's version of the same gap
-- is a separate decision, deliberately: a resolution can never grow to cover a
-- problem nobody has seen.
--
-- Findings are recomputed from Momence every run and matched against these
-- keys; a resolved finding is dropped before the digest is taken, so it
-- neither shows in the email nor keeps a list looking "changed".

create table public.schedule_lint_resolutions (
  -- The finding key: rule-specific, stable, and opaque to this table.
  key text primary key,
  -- The rule instance that raised it, so deleting a rule takes its
  -- resolutions with it and the page can group them.
  rule_id text not null,
  -- The finding as it read when it was resolved: keys are unreadable, and the
  -- session behind one may be gone by the time somebody reviews the list.
  summary text not null,
  -- Optional "why this is fine", shown next to the entry.
  note text,
  -- Dashboard email of whoever resolved it.
  resolved_by text,
  created_at timestamptz not null default now(),
  -- Touched by every run in which the finding was raised again. A resolution
  -- only matters while its finding recurs, so rows that stop being seen are
  -- pruned by the job rather than accumulating forever.
  last_seen_at timestamptz not null default now()
);

-- The job prunes by last_seen_at and the page lists by rule.
create index schedule_lint_resolutions_last_seen_idx
  on public.schedule_lint_resolutions (last_seen_at);

create index schedule_lint_resolutions_rule_idx
  on public.schedule_lint_resolutions (rule_id);

-- App access is service-role (bypasses RLS) and gated in-route by
-- requirePage; these policies are the forward-looking convention, same as
-- schedule_lint_rules.
alter table public.schedule_lint_resolutions enable row level security;

create policy "admins can select schedule lint resolutions"
  on public.schedule_lint_resolutions for select
  using (public.is_admin());

create policy "admins can insert schedule lint resolutions"
  on public.schedule_lint_resolutions for insert
  with check (public.is_admin());

create policy "admins can update schedule lint resolutions"
  on public.schedule_lint_resolutions for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins can delete schedule lint resolutions"
  on public.schedule_lint_resolutions for delete
  using (public.is_admin());
