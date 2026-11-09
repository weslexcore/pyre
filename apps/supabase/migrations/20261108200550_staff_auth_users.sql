-- Dashboard logins move from Momence OAuth to Supabase Auth
-- (apps/integrations). A person's identity stays their email — every
-- attribution column in this schema (author_email, created_by, actor,
-- recipient_email, ...) is an email, and `staff.email` remains the key the
-- app matches a login against. What changes is where the login comes from:
-- an auth.users row, which this migration links to the staff row and which
-- the RLS helpers below resolve through.
--
-- Until now public.is_admin() read raw_user_meta_data->>'role' on auth.users,
-- which nothing ever set, so every one of the ~200 policies calling it was
-- false for any JWT. The staff table has been the real source of truth for
-- dashboard access since the dashboard_users merge; the helpers now read it.
--
-- Additive and inert for the running app: production uses the service-role
-- client (bypasses RLS) and Momence cookies, and these functions only change
-- results for callers holding a Supabase JWT, of which there are none yet.
--
-- Follow-up (not here): four select policies grant `authenticated` with
-- `using (true)` — shift_duties, cold_plunges, staff_duty_training,
-- duty_assignments. Once staff hold Supabase sessions and a browser client
-- exists, those become readable by any signed-in staff member; tighten them
-- to public.has_page(...) in a later migration.

-- The auth.users row behind this person. Set by the app when the person is
-- added on /admin/users (the auth user is pre-created, invite-only) or by the
-- seed script for existing rows, and as a fallback on first sign-in. Nullable:
-- roster-only people have no login.
alter table public.staff
  add column user_id uuid unique references auth.users (id) on delete set null;

comment on column public.staff.user_id is
  'auth.users row for this person''s dashboard login. Set when the person is added (pre-created auth user) or on first sign-in; null for roster-only people.';

-- The caller's staff row: by user_id, else by the JWT email for a row that
-- has not been linked yet (the link is written on first sign-in). Security
-- definer so this runs as the table owner: the staff table's own policies
-- call is_admin(), which calls this, and the owner bypasses RLS, so the
-- lookup never recurses into the policies it serves. search_path pinned, as
-- every security-definer function here is.
create or replace function public.current_staff_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.id
  from public.staff s
  where s.user_id = auth.uid()
     or (s.user_id is null and s.email = lower(auth.jwt() ->> 'email'))
  order by (s.user_id = auth.uid()) desc nulls last
  limit 1;
$$;

comment on function public.current_staff_id() is
  'staff.id of the signed-in caller: matched by staff.user_id, else by the JWT email for an unlinked row. Null for anon, service_role, or anyone not on the staff table.';

-- The caller's email as the app attributes rows: the staff row's email, else
-- the JWT email (an env-allowlisted admin without a staff row).
create or replace function public.current_staff_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.email from public.staff s where s.id = public.current_staff_id()),
    lower(auth.jwt() ->> 'email')
  );
$$;

comment on function public.current_staff_email() is
  'Lowercased email of the signed-in caller, as rows are attributed: the staff row''s email, else the JWT email.';

-- Was: raw_user_meta_data->>'role' = 'admin' on the caller's auth.users row
-- (never populated). Now the staff table decides, as it already does for the
-- app. Same name and signature, so the existing policies need no change.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.is_admin from public.staff s where s.id = public.current_staff_id()),
    false
  );
$$;

comment on function public.is_admin() is
  'True when the signed-in caller''s staff row has is_admin. Used by the RLS policies on every admin-managed table.';

-- Page grants, for policies finer than admin-or-nothing. Admins hold every
-- page; everyone else holds exactly the hrefs and capability keys in
-- staff.pages (e.g. '/admin/water', 'schedule:manage'). Valid keys live in
-- code (adminTools.ts), not in a check constraint.
create or replace function public.has_page(page text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.is_admin or page = any (s.pages)
     from public.staff s
     where s.id = public.current_staff_id()),
    false
  );
$$;

comment on function public.has_page(text) is
  'True when the signed-in caller is an admin or holds `page` (an admin page href or capability key) in staff.pages.';
