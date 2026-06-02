-- Instagram comment auto-reply automation.
-- See plan: /Users/w/.claude/plans/we-want-to-create-squishy-beaver.md

-- Reusable admin check: matches the pattern documented in CLAUDE.md.
-- Looks at raw_user_meta_data.role on the auth.users row for the current jwt.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (select raw_user_meta_data->>'role' = 'admin'
     from auth.users
     where id = auth.uid()),
    false
  );
$$;

-- Rules: one row per keyword the bot listens for, scoped to an IG account.
create table public.instagram_rules (
  id uuid primary key default gen_random_uuid(),
  keyword text not null,
  comment_reply text not null,
  dm_message text not null,
  is_active boolean not null default true,
  ig_business_account_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Only one active rule per (account, keyword). Case-insensitive.
create unique index instagram_rules_active_keyword_idx
  on public.instagram_rules (ig_business_account_id, lower(keyword))
  where is_active;

alter table public.instagram_rules enable row level security;

create policy "admins can select rules"
  on public.instagram_rules for select
  to authenticated
  using (public.is_admin());

create policy "admins can insert rules"
  on public.instagram_rules for insert
  to authenticated
  with check (public.is_admin());

create policy "admins can update rules"
  on public.instagram_rules for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins can delete rules"
  on public.instagram_rules for delete
  to authenticated
  using (public.is_admin());

-- Events: audit log of every webhook delivery we acted on.
-- comment_id is unique so we can use it as an idempotency key (Meta retries deliveries).
create table public.instagram_events (
  id uuid primary key default gen_random_uuid(),
  comment_id text not null unique,
  rule_id uuid references public.instagram_rules(id) on delete set null,
  media_id text,
  ig_user_id text,
  username text,
  comment_text text,
  reply_status text,
  reply_error text,
  dm_status text,
  dm_error text,
  like_status text,
  like_error text,
  received_at timestamptz not null default now()
);

create index instagram_events_received_at_idx
  on public.instagram_events (received_at desc);

alter table public.instagram_events enable row level security;

create policy "admins can select events"
  on public.instagram_events for select
  to authenticated
  using (public.is_admin());

create policy "admins can insert events"
  on public.instagram_events for insert
  to authenticated
  with check (public.is_admin());

create policy "admins can update events"
  on public.instagram_events for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins can delete events"
  on public.instagram_events for delete
  to authenticated
  using (public.is_admin());

-- Note: the webhook handler uses the Supabase service-role key which bypasses RLS entirely,
-- so it does not need a dedicated policy.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger instagram_rules_set_updated_at
  before update on public.instagram_rules
  for each row execute function public.set_updated_at();
