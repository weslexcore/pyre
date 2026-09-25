-- App settings: switches and choices admins change from /admin/settings
-- instead of setting an environment variable and redeploying. One row per
-- setting that someone has saved; a setting with no row falls back to its
-- environment variable (where it has one) and then to its default, both
-- defined in code (apps/integrations src/lib/settings/registry.ts), which is
-- also where each setting's type and allowed values live — so adding a
-- setting needs no migration.
--
-- Deleting a row is "reset": the setting goes back to the env/default value.
-- The app caches rows for ~30 seconds per server instance, so a change takes
-- effect everywhere within that.

create table public.app_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-zA-Z0-9_]*)+$'),
  -- The saved value, validated in the app against the setting's definition:
  -- true/false, a number, or a list of choices.
  value jsonb not null,
  -- Dashboard email of the admin who last saved it.
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;

-- App access is service-role (bypasses RLS); forward-looking convention like
-- the other admin tables.
create policy "admins can select app settings"
  on public.app_settings for select
  using (public.is_admin());

create policy "admins can insert app settings"
  on public.app_settings for insert
  with check (public.is_admin());

create policy "admins can update app settings"
  on public.app_settings for update
  using (public.is_admin());

create policy "admins can delete app settings"
  on public.app_settings for delete
  using (public.is_admin());

comment on table public.app_settings is
  'Admin-managed feature switches and choices (/admin/settings). A row overrides the setting''s env var and default, both defined in code; no row means not set here.';
