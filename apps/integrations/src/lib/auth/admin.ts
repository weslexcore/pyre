// Admin gates: Momence OAuth session + the staff table (managed
// from /admin/users; env allowlists are only the bootstrap fallback — see
// ./access.ts). requireAdmin gates admin-only routes; requirePage gates a
// route on view access to the admin page it serves.

import type { AstroCookies } from 'astro';
import { canViewPage, hasScheduleManage } from '@/components/admin/adminTools';
import { type DashboardAccess, getAccess } from './access';
import { validateSession } from './session';
import type { MomenceUserProfile } from './types';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export interface AdminGate {
  user: MomenceUserProfile;
  access: DashboardAccess;
}

async function requireAccess(
  cookies: AstroCookies,
  isAllowed: (access: DashboardAccess) => boolean
): Promise<AdminGate | Response> {
  const { session } = await validateSession(cookies);

  if (!session.isAuthenticated || !session.user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: JSON_HEADERS,
    });
  }

  const access = session.user.email ? await getAccess(session.user.email) : null;
  if (!access || !isAllowed(access)) {
    return new Response(
      JSON.stringify({
        error: 'Forbidden',
        detected: { email: session.user.email || null, userId: session.user.id || null },
      }),
      { status: 403, headers: JSON_HEADERS }
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
 * admins, and any user granted view access to `page` (a tool href from
 * adminTools.ts, e.g. '/admin/water'). schedule:manage implies the schedule
 * view grant.
 */
export async function requirePage(
  cookies: AstroCookies,
  page: string
): Promise<AdminGate | Response> {
  return requireAccess(cookies, (access) => canViewPage(access, page));
}

/**
 * Weakest gate: passes anyone getAccess resolves — i.e. any user with
 * dashboard access at all, including roster-only staff who hold nothing but
 * the implicit shift-notes grant. For routes serving the /admin directory
 * itself (e.g. tool pins), which every dashboard user may use.
 */
export async function requireStaff(cookies: AstroCookies): Promise<AdminGate | Response> {
  return requireAccess(cookies, () => true);
}

/**
 * Gate for the schedule's manage side (shift/assignment mutations, roster,
 * Momence sync, AI drafts, other people's time off): passes admins and users
 * holding the schedule:manage capability.
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
    return new Response(JSON.stringify({ error: 'Cross-origin request rejected' }), {
      status: 403,
      headers: JSON_HEADERS,
    });
  }

  return null;
}
