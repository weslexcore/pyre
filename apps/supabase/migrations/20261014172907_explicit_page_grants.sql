-- every dashboard page is now an explicit grant on staff.pages, admins
-- included. until now two things opened pages without a grant:
--
--   1. is_admin opened every page, and business, people, suggestions, and
--      settings were reachable by admins only (never grantable).
--   2. an active roster row was given shift notes implicitly.
--
-- the app no longer does either (adminTools.canViewPage, lib/auth/access):
-- is_admin now only unlocks the manage side of the pages a person holds.
-- this backfill writes the access people already had into their rows, so
-- nobody gains or loses a page on deploy — from here on it is all set on
-- /admin/users.
--
-- data only: no schema, rls, or grant changes.

-- 1. admins keep every page they could open. the list is every tool href
--    in adminTools.ADMIN_TOOLS at the time of this migration.
update public.staff
set pages = (
  select array_agg(distinct page order by page)
  from unnest(
    pages || array[
      '/admin/schedule',
      '/admin/schedule-lint',
      '/admin/water',
      '/admin/inventory',
      '/admin/sops',
      '/admin/ask',
      '/admin/incidents',
      '/admin/lost-found',
      '/admin/guests',
      '/admin/shift-notes',
      '/admin/boards',
      '/admin/journeys',
      '/admin/email-templates',
      '/admin/campaigns',
      '/admin/partners',
      '/admin/referrals',
      '/admin/email',
      '/admin/webhooks',
      '/admin/suggestions',
      '/admin/business',
      '/admin/users',
      '/admin/settings'
    ]::text[]
  ) as page
)
where is_admin;

-- 2. everyone on the schedule keeps shift notes. only rows with a login
--    email: a grant on a row nobody can sign in as is refused by the app.
update public.staff
set pages = array_append(pages, '/admin/shift-notes')
where active
  and email is not null
  and not ('/admin/shift-notes' = any(pages));
