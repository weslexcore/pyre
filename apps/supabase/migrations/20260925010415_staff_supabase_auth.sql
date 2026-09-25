-- Staff sign in with Supabase Auth instead of Momence OAuth.
--
-- The integrations admin dashboard moves its session from raw Momence OAuth
-- tokens to Supabase Auth, so the browser can use the Supabase client with
-- RLS enforced per staff member. During the cutover, staff sign in through
-- Momence once and set a password; that creates their auth.users row and
-- links it here. Accounts are only ever created server-side (public sign-ups
-- are off), and only for emails a staff row grants dashboard access to.
--
-- This migration:
--   1. links each staff row to the auth user it signs in as;
--   2. rewrites public.is_admin() to trust the staff table instead of
--      user-editable user metadata (every existing is_admin() policy picks
--      this up unchanged);
--   3. adds current_staff_id() / staff_can_view() for page-scoped policies;
--   4. lets a signed-in staff member read their own staff row;
--   5. adds a service-role-only lookup from email to auth user id.

-- ---------------------------------------------------------------------------
-- 1. staff.auth_user_id
-- ---------------------------------------------------------------------------

-- Set once the person has a password (first sign-in after the cutover, or an
-- emailed set-password link). The email stays the lookup key in app code;
-- this column is what RLS joins on, via auth.uid().
alter table public.staff
  add column auth_user_id uuid unique references auth.users (id) on delete set null;

comment on column public.staff.auth_user_id is
  'Supabase Auth user this person signs in as; null until they set a password. RLS helpers (is_admin, staff_can_view) resolve the caller through it.';

-- ---------------------------------------------------------------------------
-- 2. is_admin(): staff table, not user metadata
-- ---------------------------------------------------------------------------

-- The previous version read auth.users.raw_user_meta_data->>'role'. User
-- metadata is writable by the user themselves (supabase.auth.updateUser({
-- data })), so once the publishable key ships to browsers anyone signed in
-- could have made themselves admin. Admin now means a staff row linked to
-- the caller with is_admin set. There is deliberately no `active` condition:
-- the app treats is_admin alone as dashboard access (canUseDashboard in
-- apps/integrations/src/lib/sops/levels.ts), and removing someone's access
-- clears is_admin.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff s
    where s.auth_user_id = (select auth.uid())
      and s.is_admin
  );
$$;

comment on function public.is_admin() is
  'True when the caller''s linked staff row has is_admin. Replaces the old raw_user_meta_data role check (user-editable).';

-- ---------------------------------------------------------------------------
-- 3. Staff helpers for page-scoped policies
-- ---------------------------------------------------------------------------

-- The caller's staff row id, when they have one that can use the dashboard
-- (mirrors canUseDashboard: admin, active, or holding a page grant). Null for
-- everyone else, including people who have left.
create or replace function public.current_staff_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.staff s
  where s.auth_user_id = (select auth.uid())
    and (s.is_admin or s.active or cardinality(s.pages) > 0)
  limit 1;
$$;

comment on function public.current_staff_id() is
  'Staff row id of the signed-in caller if they have dashboard access, else null.';

-- Whether the caller may view an admin page (href, e.g. '/admin/water') or
-- holds a capability key (e.g. 'schedule:manage'). Mirrors getAccess() in
-- apps/integrations/src/lib/auth/access.ts: admins see everything; active
-- staff get shift notes implicitly; otherwise it's the pages grant.
create or replace function public.staff_can_view(p_page text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff s
    where s.auth_user_id = (select auth.uid())
      and (s.is_admin or s.active or cardinality(s.pages) > 0)
      and (
        s.is_admin
        or p_page = any (s.pages)
        or (s.active and p_page = '/admin/shift-notes')
      )
  );
$$;

comment on function public.staff_can_view(text) is
  'True when the signed-in caller may view the given admin page href or holds the capability key. Mirrors getAccess() in the integrations app.';

-- These run as definer; callers only need execute. anon never has a staff
-- row, so there's nothing for it to learn from them.
revoke all on function public.current_staff_id() from public, anon;
revoke all on function public.staff_can_view(text) from public, anon;
grant execute on function public.current_staff_id() to authenticated, service_role;
grant execute on function public.staff_can_view(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Staff can read their own row
-- ---------------------------------------------------------------------------

-- Admins already read every row ("admins can select staff"). This adds a
-- person's own row — including their calendar_token, which is theirs.
create policy "staff can select own row"
  on public.staff
  for select
  to authenticated
  using (auth_user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. Email -> auth user id (service role only)
-- ---------------------------------------------------------------------------

-- The admin API has no get-user-by-email, and the integrations app needs one
-- when a pending invite already created the auth user. Never callable from a
-- browser: it would enumerate accounts.
create or replace function public.auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;
$$;

comment on function public.auth_user_id_by_email(text) is
  'Service-role-only: the auth.users id for an email (used by staff account provisioning).';

revoke all on function public.auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_id_by_email(text) to service_role;
