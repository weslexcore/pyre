// Admin gate: Momence OAuth session + ADMIN_EMAILS allowlist (same contract as
// the landing-page admin dashboard — set ADMIN_EMAILS on this deployment too).

import type { AstroCookies } from 'astro';
import { validateSession } from './session';
import type { MomenceUserProfile } from './types';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export function isAdminEmail(email: string): boolean {
  const adminEmails = import.meta.env.ADMIN_EMAILS ?? '';
  if (!adminEmails) return false;

  const allowlist = adminEmails
    .split(',')
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean);

  return allowlist.includes(email.toLowerCase());
}

/**
 * The 401/403 preamble every admin API route needs. Returns the authenticated
 * admin user, or a ready-to-return JSON error Response (check with
 * `instanceof Response`).
 */
export async function requireAdmin(
  cookies: AstroCookies
): Promise<{ user: MomenceUserProfile } | Response> {
  const { session } = await validateSession(cookies);

  if (!session.isAuthenticated || !session.user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: JSON_HEADERS,
    });
  }

  if (!session.user.email || !isAdminEmail(session.user.email)) {
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
