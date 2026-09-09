// One generated link: PATCH relabels it or mints a short link for a legacy
// link that has none; DELETE removes it along with its short link (after
// which the /s/<code> URL redirects home).

import {
  createShortLink,
  deleteLink,
  getLink,
  ShortLinkError,
  updateLink,
} from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import { shortUrlFor } from '@/lib/campaigns/server';
import type { LinkRow } from '@/lib/campaigns/types';
import { FIELD_LIMITS } from '@/lib/campaigns/validate';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export const PATCH: APIRoute = async ({ cookies, params, request }) => {
  const gate = await requirePage(cookies, '/admin/campaigns');
  if (gate instanceof Response) return gate;
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

  let body: { label?: unknown; mintShort?: unknown };
  try {
    body = (await request.json()) as { label?: unknown; mintShort?: unknown };
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  try {
    const link = await getLink(params.linkId ?? '');
    if (!link || link.campaignId !== params.id) return json({ error: 'not_found' }, 404);

    let shortCode = link.shortCode;
    let clicks = 0;
    if (body.mintShort === true && !shortCode) {
      const short = await createShortLink({
        url: link.url,
        label: link.label,
        createdBy: gate.user.email ?? '',
      });
      shortCode = short.code;
      clicks = 0;
    }

    const patch: { label?: string; shortCode?: string } = {};
    if (typeof body.label === 'string') patch.label = body.label.slice(0, FIELD_LIMITS.label);
    if (shortCode !== link.shortCode) patch.shortCode = shortCode;

    const updated = Object.keys(patch).length > 0 ? await updateLink(link.id, patch) : link;
    if (!updated) return json({ error: 'not_found' }, 404);

    const row: LinkRow = {
      ...updated,
      shortUrl: updated.shortCode ? shortUrlFor(updated.shortCode) : null,
      clicks,
    };
    return json({ link: row });
  } catch (err) {
    if (err instanceof ShortLinkError) {
      return json({ error: err.code }, err.code === 'storage_unavailable' ? 503 : 400);
    }
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};

export const DELETE: APIRoute = async ({ cookies, params, request }) => {
  const gate = await requirePage(cookies, '/admin/campaigns');
  if (gate instanceof Response) return gate;
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

  try {
    const link = await getLink(params.linkId ?? '');
    if (!link || link.campaignId !== params.id) return json({ error: 'not_found' }, 404);
    await deleteLink(link.id);
    return json({ ok: true });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};
