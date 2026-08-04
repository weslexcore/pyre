// Admin gate: Momence OAuth session + ADMIN_EMAILS allowlist (same contract as
// the landing-page admin dashboard — set ADMIN_EMAILS on this deployment too).
// Staff-facing tools (e.g. /admin/water) use the wider STAFF_EMAILS allowlist;
// admins are implicitly staff.

import type { AstroCookies } from 'astro';
import { validateSession } from './session';
import type { MomenceUserProfile } from './types';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function inAllowlist(email: string, allowlistEnv: string | undefined): boolean {
  if (!allowlistEnv) return false;

  const allowlist = allowlistEnv
    .split(',')
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean);

  return allowlist.includes(email.toLowerCase());
}

export function isAdminEmail(email: string): boolean {
  return inAllowlist(email, import.meta.env.ADMIN_EMAILS);
}

export function isStaffEmail(email: string): boolean {
  return inAllowlist(email, import.meta.env.STAFF_EMAILS) || isAdminEmail(email);
}

async function requireAllowlisted(
  cookies: AstroCookies,
  isAllowed: (email: string) => boolean
): Promise<{ user: MomenceUserProfile } | Response> {
  const { session } = await validateSession(cookies);

  if (!session.isAuthenticated || !session.user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: JSON_HEADERS,
    });
  }

  if (!session.user.email || !isAllowed(session.user.email)) {
    return new Response(
      JSON.stringify({
        error: 'Forbidden',
        detected: { email: session.user.email || null, userId: session.user.id || null },
      }),
      { status: 403, headers: JSON_HEADERS }
    );
  }

  return { user: session.user };
}

/**
 * The 401/403 preamble every admin API route needs. Returns the authenticated
 * admin user, or a ready-to-return JSON error Response (check with
 * `instanceof Response`).
 */
export async function requireAdmin(
  cookies: AstroCookies
): Promise<{ user: MomenceUserProfile } | Response> {
  return requireAllowlisted(cookies, isAdminEmail);
}

/** Same contract as requireAdmin, against the wider staff allowlist. */
export async function requireStaff(
  cookies: AstroCookies
): Promise<{ user: MomenceUserProfile } | Response> {
  return requireAllowlisted(cookies, isStaffEmail);
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
