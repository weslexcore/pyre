// Standalone short links (the /admin/campaigns/shortlinks page). GET lists
// every short link no campaign link owns; POST mints one, with an optional
// custom name that must not collide with any existing code — campaign-minted
// ones included, since they share the store. Gated on the /admin/campaigns
// page grant; POST is CSRF-guarded in-route (global checkOrigin is off, see
// astro.config.mjs).

import { createShortLink, ShortLinkError } from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import { parseExternalUrl } from '@/lib/campaigns/links';
import { LANDING_ORIGIN, shortUrlFor } from '@/lib/campaigns/server';
import { aliasError, normalizeAlias, SHORT_LINK_LIMITS } from '@/lib/shortlinks/alias';
import { listStandaloneShortLinks } from '@/lib/shortlinks/server';
import type { ShortLinkListResponse, StandaloneShortLink } from '@/lib/shortlinks/types';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requirePage(cookies, '/admin/campaigns');
  if (gate instanceof Response) return gate;

  try {
    const { links, total, truncated } = await listStandaloneShortLinks();
    const body: ShortLinkListResponse = { links, total, truncated, origin: LANDING_ORIGIN };
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

  const destination = parseExternalUrl(text(body.url, SHORT_LINK_LIMITS.url));
  if (!destination) return json({ error: 'invalid_destination' }, 400);

  const alias = normalizeAlias(text(body.alias, SHORT_LINK_LIMITS.alias));
  const aliasProblem = aliasError(alias);
  if (aliasProblem) return json({ error: 'invalid_alias' }, 400);

  try {
    const short = await createShortLink({
      url: destination.toString(),
      alias: alias || undefined,
      label: text(body.label, SHORT_LINK_LIMITS.label),
      createdBy: gate.user.email ?? '',
    });
    const link: StandaloneShortLink = {
      code: short.code,
      shortUrl: shortUrlFor(short.code),
      url: short.url,
      label: short.label,
      clicks: 0,
      createdAt: short.createdAt,
      createdBy: short.createdBy,
      campaign: null,
    };
    return json({ link }, 201);
  } catch (err) {
    if (err instanceof ShortLinkError) {
      const status =
        err.code === 'storage_unavailable' ? 503 : err.code === 'alias_taken' ? 409 : 400;
      return json({ error: err.code }, status);
    }
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};
