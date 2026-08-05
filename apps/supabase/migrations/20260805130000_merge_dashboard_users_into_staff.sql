-- One person, one row. dashboard_users (who may use the admin dashboard) and
-- schedule_staff (the scheduling roster) described the same people and were
-- linked only by a hand-typed email, so the two admin pages could drift. This
-- folds dashboard access into the roster table, renamed `staff`, and
-- /admin/users now manages the whole person: dashboard access, founder, and
-- whether they're available to schedule.
--
-- shift_assignments and time_off already point at this table, so the rename
-- keeps every assignment and time-off row attached to its person.

alter table public.schedule_staff rename to staff;

-- momence_email was the scheduling join key; it is now also the dashboard
-- login key, so the scheduling-specific name no longer fits.
alter table public.staff rename column momence_email to email;

alter table public.staff
  -- admins see every page and manage this table
  add column is_admin boolean not null default false,
  -- admin page hrefs a non-admin may view (e.g. '/admin/water'), plus
  -- capability keys like 'schedule:manage'. Valid keys live in code
  -- (adminTools.ts), not in a check constraint, so adding a tool doesn't
  -- need a migration.
  add column pages text[] not null default '{}',
  -- best-effort snapshot from the Momence member lookup when the email is set
  add column momence_member_id bigint,
  -- email of the admin who added the person
  add column added_by text;

-- Lookups are a plain equality check against the OAuth profile email.
update public.staff set email = lower(email) where email is distinct from lower(email);

alter table public.staff
  add constraint staff_email_lowercase check (email is null or email = lower(email));

-- Dashboard users already on the roster: keep their row, adopt their access.
update public.staff s
set
  is_admin = d.is_admin,
  pages = d.pages,
  momence_member_id = d.momence_member_id,
  added_by = d.added_by,
  display_name = coalesce(nullif(s.display_name, ''), d.display_name, split_part(d.email, '@', 1))
from public.dashboard_users d
where s.email = d.email;

-- Dashboard users who were never on the roster: they get a row so the page can
-- manage them, but stay off the schedule (active = false) until an admin says
-- otherwise.
insert into public.staff (
  display_name, email, is_admin, pages, momence_member_id, added_by, is_founder, active
)
select
  coalesce(nullif(d.display_name, ''), split_part(d.email, '@', 1)),
  d.email,
  d.is_admin,
  d.pages,
  d.momence_member_id,
  d.added_by,
  false,
  false
from public.dashboard_users d
where not exists (select 1 from public.staff s where s.email = d.email);

drop table public.dashboard_users;

-- Superseded by is_admin, which is the real dashboard-access flag. Nothing
-- read this column (assignment roles are a separate `role` on
-- shift_assignments).
alter table public.staff drop column role;

alter policy "admins can select schedule staff" on public.staff rename to "admins can select staff";
alter trigger schedule_staff_set_updated_at on public.staff rename to staff_set_updated_at;
