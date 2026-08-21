-- QuickBooks Online OAuth tokens: one row per connected QuickBooks company
-- (realm), written by the /api/quickbooks/callback route after the admin
-- completes Intuit's authorization-code flow. Access tokens live ~1 hour,
-- refresh tokens ~100 days and ROTATE on every refresh, so the row is
-- rewritten each time the app refreshes — both expiries are stored so the
-- client can refresh proactively and the status route can warn before the
-- refresh token dies (which forces a reconnect).
--
-- The app reads and writes this table with the service-role key only; tokens
-- must never travel to a browser. RLS policies below are the forward-looking
-- convention used by the other integrations tables.

create table public.quickbooks_tokens (
  -- Intuit company id, handed back as ?realmId= on the OAuth redirect.
  realm_id text primary key check (char_length(realm_id) between 1 and 64),
  access_token text not null,
  refresh_token text not null,
  access_token_expires_at timestamptz not null,
  refresh_token_expires_at timestamptz not null,
  environment text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  -- Email from the admin session that ran the connect flow, never request body.
  connected_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger quickbooks_tokens_set_updated_at
  before update on public.quickbooks_tokens
  for each row execute function public.set_updated_at();

alter table public.quickbooks_tokens enable row level security;

-- App access is service-role (bypasses RLS); granular admin policies follow
-- the repo convention.
create policy "admins can select quickbooks tokens"
  on public.quickbooks_tokens for select
  using (public.is_admin());

create policy "admins can insert quickbooks tokens"
  on public.quickbooks_tokens for insert
  with check (public.is_admin());

create policy "admins can update quickbooks tokens"
  on public.quickbooks_tokens for update
  using (public.is_admin());

create policy "admins can delete quickbooks tokens"
  on public.quickbooks_tokens for delete
  using (public.is_admin());

comment on table public.quickbooks_tokens is
  'OAuth2 tokens for connected QuickBooks Online companies (see apps/integrations src/lib/quickbooks). Refresh tokens rotate on every refresh; service-role access only.';
