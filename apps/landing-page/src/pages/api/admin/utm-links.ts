import { createCampaign, deleteLink, saveLink, updateLinkLabel } from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import { isAdminEmail } from '@/lib/admin';
import { validateSession } from '@/lib/auth-session';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

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

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export const POST: APIRoute = async ({ cookies, request }) => {
  const auth = await requireAdmin(cookies);
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const campaignName = str(body.campaign);
  const url = str(body.url);
  if (!campaignName.trim() || !url) {
    return json({ error: 'utm_campaign and url are required' }, 400);
  }

  try {
    // The campaign a link belongs to is determined by its utm_campaign value:
    // upsert the campaign for that name/slug, then file the link under it.
    const campaign = await createCampaign({ name: campaignName, createdBy: auth.email });
    if (!campaign) return json({ error: 'Storage unavailable or invalid campaign' }, 503);

    const link = await saveLink({
      campaignId: campaign.id,
      label: str(body.label),
      url,
      destination: str(body.destination),
      source: str(body.source),
      medium: str(body.medium),
      campaign: str(body.campaign),
      term: str(body.term),
      content: str(body.content),
      createdBy: auth.email,
    });
    if (!link) return json({ error: 'Campaign not found or storage unavailable' }, 404);
    return json({ link }, 201);
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
    await deleteLink(id);
    return json({ ok: true });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};

// Relabel a saved link (only the friendly label changes).
export const PATCH: APIRoute = async ({ cookies, request }) => {
  const auth = await requireAdmin(cookies);
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const id = str(body.id);
  if (!id) return json({ error: 'id is required' }, 400);

  try {
    const link = await updateLinkLabel(id, str(body.label));
    if (!link) return json({ error: 'Link not found' }, 404);
    return json({ link });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};
