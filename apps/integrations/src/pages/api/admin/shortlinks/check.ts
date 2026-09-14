// Live checks for the short link form: ?alias= says whether a custom name is
// already in use (any short link, campaign-minted or not); ?url= lists the
// short links already sending people to that destination, so the form can
// warn before a second one is made. Read-only, gated like the page.

import { codeExists } from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import { requirePage } from '@/lib/auth/admin';
import { parseExternalUrl } from '@/lib/campaigns/links';
import { normalizeAlias, SHORT_LINK_LIMITS } from '@/lib/shortlinks/alias';
import { findShortLinksTo } from '@/lib/shortlinks/server';
import type { ShortLinkCheckResponse } from '@/lib/shortlinks/types';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, '/admin/campaigns');
  if (gate instanceof Response) return gate;

  const body: ShortLinkCheckResponse = {};
  try {
    const alias = normalizeAlias((url.searchParams.get('alias') ?? '').slice(0, 200));
    if (alias) body.aliasTaken = await codeExists(alias);

    const destination = parseExternalUrl(
      (url.searchParams.get('url') ?? '').slice(0, SHORT_LINK_LIMITS.url)
    );
    if (destination) body.existing = await findShortLinksTo(destination.toString());

    return json(body);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};
