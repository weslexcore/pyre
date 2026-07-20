// Shared UTM campaign list for the admin UTM Assist tool, ported from the
// landing-page admin. Backed by the shared Upstash store in @pyre/webhook-core.

import { deleteCampaign, listCampaignsWithLinks } from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/auth/admin';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  try {
    const campaigns = await listCampaignsWithLinks();
    return json({ campaigns });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};

export const DELETE: APIRoute = async ({ cookies, url }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400);

  try {
    await deleteCampaign(id);
    return json({ ok: true });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};
