// Admin-only short-link management, ported from the landing-page admin. POST
// creates a short link for a UTM-tagged URL built in the UTM Assist tool; GET
// lists recent links for reuse. The public /s/<code> redirect stays on the
// landing site, so short URLs are minted against that origin — not this app's.

import {
  createShortLink,
  deleteShortLink,
  listShortLinks,
  ShortLinkError,
  updateShortLinkLabel,
} from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/auth/admin';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const LANDING_ORIGIN = import.meta.env.PUBLIC_SITE_URL ?? 'https://pyresauna.com';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? '0'), 0);

  const { links, total } = await listShortLinks(limit, offset);
  return json({ links, total, limit, offset }, 200);
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  let body: { url?: string; label?: string; alias?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const targetUrl = (body.url ?? '').trim();
  if (!targetUrl) return json({ error: 'Missing url' }, 400);

  // Any http(s) destination is allowed — creation is admin-gated (requireAdmin
  // above), so this is not an open redirector: only admins can mint codes.
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return json({ error: 'invalid_url' }, 400);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return json({ error: 'invalid_url' }, 400);
  }

  try {
    const link = await createShortLink({
      url: targetUrl,
      label: body.label,
      alias: body.alias?.trim() || undefined,
      createdBy: gate.user.email ?? '',
    });
    return json({ ...link, shortUrl: `${LANDING_ORIGIN}/s/${link.code}` }, 201);
  } catch (err) {
    if (err instanceof ShortLinkError) {
      const status = err.code === 'alias_taken' ? 409 : 400;
      return json({ error: err.code }, status);
    }
    console.error('[shortlinks] create failed:', err);
    return json({ error: 'server_error' }, 500);
  }
};

// Rename/retag: change only the label of an existing short link.
export const PATCH: APIRoute = async ({ cookies, request }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  let body: { code?: string; label?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const code = (body.code ?? '').trim();
  if (!code) return json({ error: 'Missing code' }, 400);

  const link = await updateShortLinkLabel(code, body.label ?? '');
  if (!link) return json({ error: 'Not found' }, 404);
  return json(link, 200);
};

// Remove a short link that's no longer needed.
export const DELETE: APIRoute = async ({ cookies, url }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const code = (url.searchParams.get('code') ?? '').trim();
  if (!code) return json({ error: 'Missing code' }, 400);

  await deleteShortLink(code);
  return json({ ok: true }, 200);
};
