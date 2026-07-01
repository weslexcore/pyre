import { deleteCampaign, listCampaignsWithLinks } from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import { isAdminEmail } from '@/lib/admin';
import { validateSession } from '@/lib/auth-session';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** Admin guard shared across the handlers. Returns the session email or an error Response. */
async function requireAdmin(
  cookies: Parameters<APIRoute>[0]['cookies']
): Promise<{ email: string } | { error: Response }> {
  const { session } = await validateSession(cookies);
  if (!session.isAuthenticated || !session.user) {
    return { error: json({ error: 'Not authenticated' }, 401) };
  }
  if (!session.user.email || !isAdminEmail(session.user.email)) {
    return { error: json({ error: 'Forbidden' }, 403) };
  }
  return { email: session.user.email };
}

export const GET: APIRoute = async ({ cookies }) => {
  const auth = await requireAdmin(cookies);
  if ('error' in auth) return auth.error;

  try {
    const campaigns = await listCampaignsWithLinks();
    return json({ campaigns });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};

export const DELETE: APIRoute = async ({ cookies, url }) => {
  const auth = await requireAdmin(cookies);
  if ('error' in auth) return auth.error;

  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400);

  try {
    await deleteCampaign(id);
    return json({ ok: true });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};
