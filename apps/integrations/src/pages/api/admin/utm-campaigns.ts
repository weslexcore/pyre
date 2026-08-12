// Shared UTM campaign list for the admin UTM Assist tool, ported from the
// landing-page admin. Backed by the shared Upstash store in @pyre/webhook-core.

import {
  deleteCampaign,
  listCampaignsWithLinks,
  listShortLinks,
  utmCampaignOfUrl,
} from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import { requirePage } from '@/lib/auth/admin';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requirePage(cookies, '/admin/utm-assist');
  if (gate instanceof Response) return gate;

  try {
    // Short links carry no campaignId — like the campaign-performance report,
    // they are joined by the utm_campaign baked into their destination URL.
    // Links without a parseable utm_campaign are omitted, and the join covers
    // the 500 newest short links (same cap the performance report uses).
    const [campaignsWithLinks, shortlinkPage] = await Promise.all([
      listCampaignsWithLinks(),
      listShortLinks(500, 0),
    ]);

    const shortlinksBySlug = new Map<
      string,
      Array<{ code: string; url: string; label: string; clicks: number; createdAt: number }>
    >();
    for (const link of shortlinkPage.links) {
      const slug = utmCampaignOfUrl(link.url);
      if (!slug) continue;
      const list = shortlinksBySlug.get(slug) ?? [];
      list.push({
        code: link.code,
        url: link.url,
        label: link.label,
        clicks: Number(link.clicks) || 0,
        createdAt: Number(link.createdAt) || 0,
      });
      shortlinksBySlug.set(slug, list);
    }

    const campaigns = campaignsWithLinks.map((entry) => ({
      ...entry,
      shortlinks: shortlinksBySlug.get(entry.campaign.slug.toLowerCase()) ?? [],
    }));
    return json({ campaigns });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};

export const DELETE: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, '/admin/utm-assist');
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
