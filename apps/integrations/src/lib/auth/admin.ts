// Admin gates: Momence OAuth session + the staff table (managed
// from /admin/users; env allowlists are only the bootstrap fallback — see
// ./access.ts). requireAdmin gates admin-only routes; requirePage gates a
// route on view access to the admin page it serves.

import type { AstroCookies } from 'astro';
import { canViewPage, hasScheduleManage } from '@/components/admin/adminTools';
import { json } from '@/lib/http/json';
import { type DashboardAccess, getAccess } from './access';
import { validateSession } from './session';
import type { MomenceUserProfile } from './types';

export interface AdminGate {
  user: MomenceUserProfile;
  access: DashboardAccess;
}

/**
 * The gate every require* below is built from: passes when `isAllowed`
 * accepts the caller's access. Exported for routes gated on a capability
 * check from adminTools (hasScheduleInsights and friends).
 */
export async function requireAccess(
  cookies: AstroCookies,
  isAllowed: (access: DashboardAccess) => boolean
): Promise<AdminGate | Response> {
  const { session } = await validateSession(cookies);

  if (!session.isAuthenticated || !session.user) {
    return json({ error: 'Not authenticated' }, 401);
  }

  const access = session.user.email ? await getAccess(session.user.email) : null;
  if (!access || !isAllowed(access)) {
    return json(
      {
        error: 'Forbidden',
        detected: { email: session.user.email || null, userId: session.user.id || null },
      },
      403
    );
  }

  return { user: session.user, access };
}

/**
 * The 401/403 preamble every admin-only API route needs. Returns the
 * authenticated admin user, or a ready-to-return JSON error Response (check
 * with `instanceof Response`).
 */
export async function requireAdmin(cookies: AstroCookies): Promise<AdminGate | Response> {
  return requireAccess(cookies, (access) => access.isAdmin);
}

/**
 * Same contract as requireAdmin, for routes serving one admin page: passes
 * any user granted view access to `page` (a tool href from adminTools.ts,
 * e.g. '/admin/water'), admins included only when they hold it too.
 * schedule:manage implies the schedule view grant.
 */
export async function requirePage(
  cookies: AstroCookies,
  page: string
): Promise<AdminGate | Response> {
  return requireAccess(cookies, (access) => canViewPage(access, page));
}

/**
 * For a route an admin uses from inside other pages as well as from its own:
 * passes admins, and anyone granted `page`. The suggestion review panel sits
 * on Shift Notes for admins and on the Suggestions page for whoever holds it.
 */
export async function requireAdminOrPage(
  cookies: AstroCookies,
  page: string
): Promise<AdminGate | Response> {
  return requireAccess(cookies, (access) => access.isAdmin || canViewPage(access, page));
}

/**
 * Same, for a route serving more than one admin page — the guest lookup is
 * used by both the incident form and the lost-and-found form, and a person
 * granted either page may use it. Passes anyone holding view access to
 * any of `pages`.
 */
export async function requireAnyPage(
  cookies: AstroCookies,
  pages: string[]
): Promise<AdminGate | Response> {
  return requireAccess(cookies, (access) => pages.some((page) => canViewPage(access, page)));
}

/**
 * Weakest gate: passes anyone getAccess resolves — i.e. any user with
 * dashboard access at all, however few pages they hold. For routes serving the /admin directory
 * itself (e.g. tool pins), which every dashboard user may use.
 */
export async function requireStaff(cookies: AstroCookies): Promise<AdminGate | Response> {
  return requireAccess(cookies, () => true);
}

/**
 * Gate for the schedule's manage side (shift/assignment mutations, roster,
 * Momence sync, AI drafts, other people's time off): passes users holding
 * the schedule:manage capability, and admins who hold the schedule page.
 */
export async function requireScheduleManage(cookies: AstroCookies): Promise<AdminGate | Response> {
  return requireAccess(cookies, hasScheduleManage);
}

/**
 * CSRF backstop for cookie-authed routes that mutate state (global
 * `checkOrigin` stays off — see astro.config.mjs). Rejects requests whose
 * Origin header disagrees with the request URL; a missing Origin is allowed
 * (browsers always send it on cross-site fetches; non-browser clients hold no
 * session cookie anyway). Returns null when the request is fine.
 */
export function assertSameOrigin(request: Request): Response | null {
  const origin = request.headers.get('origin');
  if (!origin) return null;

  if (origin !== new URL(request.url).origin) {
    return json({ error: 'Cross-origin request rejected' }, 403);
  }

  return null;
}
