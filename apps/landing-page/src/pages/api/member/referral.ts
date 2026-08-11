// Member referral endpoint: the logged-in member's personal referral code,
// link, and stats. Auth is the Momence OAuth session; the data comes from the
// integrations service (get-or-create, so first visit mints the code).

import type { APIRoute } from 'astro';
import { validateSession } from '@/lib/auth-session';

export const prerender = false;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-cache' },
  });
}

export const GET: APIRoute = async ({ cookies }) => {
  const { session } = await validateSession(cookies);
  if (!session.isAuthenticated || !session.user?.email) {
    return json(401, { error: 'not_authenticated', referral: null });
  }

  const integrationsUrl = import.meta.env.INTEGRATIONS_API_URL ?? process.env.INTEGRATIONS_API_URL;
  const apiSecret = import.meta.env.REFERRAL_API_SECRET ?? process.env.REFERRAL_API_SECRET;
  if (!integrationsUrl || !apiSecret) {
    console.error('[Referral] INTEGRATIONS_API_URL / REFERRAL_API_SECRET not configured');
    return json(503, { error: 'unavailable', referral: null });
  }

  try {
    const response = await fetch(`${integrationsUrl}/api/referral/me`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiSecret}`,
      },
      body: JSON.stringify({
        email: session.user.email,
        firstName: session.user.firstName,
      }),
    });
    if (!response.ok) {
      console.error(`[Referral] Integrations /me failed: ${response.status}`);
      return json(response.status === 404 ? 404 : 502, { error: 'unavailable', referral: null });
    }
    const referral = await response.json();
    return json(200, { referral });
  } catch (error) {
    console.error('[Referral] Integrations /me errored', error);
    return json(502, { error: 'unavailable', referral: null });
  }
};
