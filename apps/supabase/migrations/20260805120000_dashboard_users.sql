-- Access control for the integrations admin dashboard (apps/integrations).
-- Replaces the ADMIN_EMAILS / STAFF_EMAILS env allowlists with rows managed
-- from the /admin/users page: each row grants one Momence login email either
-- full admin access (is_admin) or view access to a specific set of admin
-- pages (pages). The env vars remain a bootstrap fallback only while this
-- table has no admin row — see apps/integrations/src/lib/auth/access.ts.

create table public.dashboard_users (
  id uuid primary key default gen_random_uuid(),
  -- Momence login email (the OAuth profile email), stored lowercased so
  -- lookups are a plain equality check
  email text not null unique check (email = lower(email)),
  -- admins see every page and manage this table; non-admins see only `pages`
  is_admin boolean not null default false,
  -- admin page hrefs this user may view (e.g. '/admin/water'); ignored for
  -- admins. Valid keys live in code (adminTools.ts), not in a check
  -- constraint, so adding a tool doesn't need a migration.
  pages text[] not null default '{}',
  -- best-effort snapshot from the Momence member lookup at add time
  display_name text,
  momence_member_id bigint,
  -- email of the admin who created the row
  added_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dashboard_users enable row level security;

-- App access is service-role (bypasses RLS); this policy is forward-looking
-- convention, same as the other tables.
create policy "admins can select dashboard users"
  on public.dashboard_users for select
  to authenticated
  using (public.is_admin());

create trigger dashboard_users_set_updated_at
  before update on public.dashboard_users
  for each row execute function public.set_updated_at();
