// Campaign list and creation for the /admin/campaigns tool. GET lists
// campaigns with their link counts and short-link clicks; POST creates one,
// refusing a name whose slug is already taken (the client offers to open the
// existing campaign instead). Gated on the /admin/campaigns page grant; POST
// is CSRF-guarded in-route (global checkOrigin is off, see astro.config.mjs).

import { createCampaign, listCampaignsWithLinks } from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import {
  campaignClicks,
  LANDING_ORIGIN,
  loadShortLinkIndex,
  orphanShortlinks,
  toLinkRows,
} from '@/lib/campaigns/server';
import type { CampaignListResponse, CampaignSummary } from '@/lib/campaigns/types';
import { normalizeCampaignInput } from '@/lib/campaigns/validate';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, '/admin/campaigns');
  if (gate instanceof Response) return gate;

  const status = url.searchParams.get('status') ?? 'active';

  try {
    const all = await listCampaignsWithLinks();
    const index = await loadShortLinkIndex(all.flatMap((c) => c.links));

    const campaigns: CampaignSummary[] = [];
    for (const { campaign, links } of all) {
      if (status !== 'all' && campaign.status !== status) continue;
      const rows = await toLinkRows(campaign, links, index);
      const orphans = orphanShortlinks(campaign, rows, index);
      campaigns.push({
        ...campaign,
        linkCount: links.length,
        clicks: campaignClicks(rows, orphans),
      });
    }

    const body: CampaignListResponse = { campaigns };
    return json(body);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
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

  const input = normalizeCampaignInput(body, LANDING_ORIGIN);
  if (!input.ok) return json({ error: input.error }, 400);

  try {
    const result = await createCampaign({ ...input.value, createdBy: gate.user.email ?? '' });
    if (result.ok) return json({ campaign: result.campaign }, 201);
    if (result.reason === 'slug_taken') {
      const { id, name, slug } = result.existing;
      return json({ error: 'slug_taken', existing: { id, name, slug } }, 409);
    }
    return json({ error: result.reason }, result.reason === 'storage_unavailable' ? 503 : 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};
