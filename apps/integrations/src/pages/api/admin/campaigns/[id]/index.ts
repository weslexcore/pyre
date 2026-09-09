// One campaign: GET returns it with every generated link (short URL and
// clicks attached) plus any short links the old tool minted under its slug;
// PATCH edits the campaign's fields (never the slug); DELETE removes the
// campaign, its links, and their short links.

import { deleteCampaign, getCampaignWithLinks, updateCampaign } from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import {
  LANDING_ORIGIN,
  loadShortLinkIndex,
  orphanShortlinks,
  toLinkRows,
} from '@/lib/campaigns/server';
import type { CampaignDetailResponse } from '@/lib/campaigns/types';
import { normalizeCampaignPatch } from '@/lib/campaigns/validate';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export const GET: APIRoute = async ({ cookies, params }) => {
  const gate = await requirePage(cookies, '/admin/campaigns');
  if (gate instanceof Response) return gate;

  const id = params.id ?? '';
  try {
    const found = await getCampaignWithLinks(id);
    if (!found) return json({ error: 'not_found' }, 404);

    const index = await loadShortLinkIndex(found.links);
    const links = await toLinkRows(found.campaign, found.links, index);
    const body: CampaignDetailResponse = {
      campaign: found.campaign,
      links,
      otherShortlinks: orphanShortlinks(found.campaign, links, index),
      origin: LANDING_ORIGIN,
    };
    return json(body);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};

export const PATCH: APIRoute = async ({ cookies, params, request }) => {
  const gate = await requirePage(cookies, '/admin/campaigns');
  if (gate instanceof Response) return gate;
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const patch = normalizeCampaignPatch(body, LANDING_ORIGIN);
  if (!patch.ok) return json({ error: patch.error }, 400);

  try {
    const campaign = await updateCampaign(params.id ?? '', patch.value);
    if (!campaign) return json({ error: 'not_found' }, 404);
    return json({ campaign });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};

export const DELETE: APIRoute = async ({ cookies, params, request }) => {
  const gate = await requirePage(cookies, '/admin/campaigns');
  if (gate instanceof Response) return gate;
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

  try {
    await deleteCampaign(params.id ?? '');
    return json({ ok: true });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};
