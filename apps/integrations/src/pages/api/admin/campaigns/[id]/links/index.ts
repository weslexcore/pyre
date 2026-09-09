// Generate a link for a placement. This is the only place links are built:
// the client sends which placement (and, optionally, a variant, a partner
// name, custom utm values, or a different destination) and the server
// composes utm_source/medium/content from the catalog, utm_campaign from the
// campaign slug, mints a /s/<code> short link, and stores both together.

import {
  createShortLink,
  deleteShortLinks,
  getCampaignWithLinks,
  ShortLinkError,
  saveLink,
} from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import { buildPlacementLink } from '@/lib/campaigns/links';
import { LANDING_ORIGIN, shortUrlFor } from '@/lib/campaigns/server';
import { slugifyPart } from '@/lib/campaigns/slug';
import type { LinkRow } from '@/lib/campaigns/types';
import { normalizeLinkRequest } from '@/lib/campaigns/validate';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export const POST: APIRoute = async ({ cookies, params, request }) => {
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

  const req = normalizeLinkRequest(body, LANDING_ORIGIN);
  if (!req.ok) return json({ error: req.error }, 400);
  const { placement, sourceOverride, custom, label } = req.value;
  // Stored slugified so two spellings of the same variant cannot both exist.
  const variant = slugifyPart(req.value.variant);

  try {
    const found = await getCampaignWithLinks(params.id ?? '');
    if (!found) return json({ error: 'not_found' }, 404);
    const { campaign, links } = found;

    const destinationUrl = req.value.destination?.url ?? campaign.destinationUrl;
    if (!destinationUrl) {
      return json({ error: 'Set where this campaign points before generating links' }, 400);
    }

    const built = buildPlacementLink({
      destinationUrl,
      slug: campaign.slug,
      placement,
      variant,
      sourceOverride,
      custom: custom ?? undefined,
    });

    // One link per placement + variant (+ partner, for partner share). The
    // custom placement is exempt: its values are free-form by definition.
    if (!placement.custom) {
      const existing = links.find(
        (l) =>
          l.placementKey === placement.key &&
          l.variant === variant &&
          (!placement.askSource || l.source === built.source)
      );
      if (existing) {
        return json({ error: 'duplicate_placement', existing: { id: existing.id } }, 409);
      }
    }

    const short = await createShortLink({
      url: built.url,
      label: label || `${campaign.name} / ${placement.label}${variant ? ` (${variant})` : ''}`,
      createdBy: gate.user.email ?? '',
    });

    const link = await saveLink({
      campaignId: campaign.id,
      label,
      url: built.url,
      destination: req.value.destination
        ? `${req.value.destination.kind}:${req.value.destination.value}`
        : `${campaign.destinationKind}:${campaign.destinationValue}`,
      source: built.source,
      medium: built.medium,
      campaign: campaign.slug,
      term: built.term,
      content: built.content,
      placementKey: placement.key,
      variant,
      shortCode: short.code,
      createdBy: gate.user.email ?? '',
    });
    if (!link) {
      // The campaign vanished between the read and the write; do not leave a
      // short link pointing at a campaign nobody can see.
      await deleteShortLinks([short.code]);
      return json({ error: 'not_found' }, 404);
    }

    const row: LinkRow = { ...link, shortUrl: shortUrlFor(short.code), clicks: 0 };
    return json({ link: row }, 201);
  } catch (err) {
    if (err instanceof ShortLinkError) {
      return json({ error: err.code }, err.code === 'storage_unavailable' ? 503 : 400);
    }
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};
