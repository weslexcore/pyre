-- Email delivery gate managed from /admin/email-templates (apps/integrations).
-- Moves the template live/gated switch and the dev whitelist out of env-only
-- config (EMAIL_LIVE_TEMPLATES / EMAIL_DEV_WHITELIST) so flipping a template
-- live or adding a test recipient is a dashboard edit instead of a redeploy.
-- The env vars survive as the baseline: a template with no override row falls
-- back to EMAIL_LIVE_TEMPLATES pattern matching, and EMAIL_DEV_WHITELIST
-- addresses stay whitelisted alongside the rows here — the same env-bootstrap
-- shape the staff and partners tables use.

-- Per-template override of the EMAIL_LIVE_TEMPLATES gate. One row per template
-- key that an admin has explicitly switched; no row = env decides. Template
-- keys are NOT foreign-keyed anywhere — the registry lives in code
-- (src/emails/registry.ts) and rows for deleted templates are harmless.
create table public.email_template_overrides (
  -- Exact registry key, e.g. 'confirmation' or 'partner-verified'. Lowercase
  -- to match the case-insensitive matching in src/lib/email/dev-mode.ts.
  template text primary key
    check (template = lower(template) and btrim(template) <> ''),
  -- true = delivers to real recipients; false = whitelist-only, even if the
  -- env pattern (e.g. 'partner-*') would make it live.
  live boolean not null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Dev-whitelist addresses added from the dashboard. These receive ALL
-- templates (live or gated), exactly like EMAIL_DEV_WHITELIST entries; env
-- entries are display-only in the UI and can only be removed by editing the
-- env var.
create table public.email_whitelist (
  email text primary key
    check (email = lower(email) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  added_by text,
  created_at timestamptz not null default now()
);

-- No secondary indexes: both tables hold at most a few dozen rows and are read
-- through a 30s in-process cache (src/lib/email/dev-mode.ts).

alter table public.email_template_overrides enable row level security;
alter table public.email_whitelist enable row level security;

-- App access is service-role (bypasses RLS); these policies are
-- forward-looking convention, same as the other tables.
create policy "admins can select email_template_overrides"
  on public.email_template_overrides for select
  to authenticated
  using (public.is_admin());

create policy "admins can select email_whitelist"
  on public.email_whitelist for select
  to authenticated
  using (public.is_admin());

create trigger email_template_overrides_set_updated_at
  before update on public.email_template_overrides
  for each row execute function public.set_updated_at();
