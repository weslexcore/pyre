// Admin-only short-link management. POST creates a short link for a UTM-tagged
// URL built in the UTM Assist tool; GET lists recent links for reuse.

import {
  createShortLink,
  deleteShortLink,
  listShortLinks,
  ShortLinkError,
  updateShortLinkLabel,
} from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import { isAdminEmail } from '@/lib/admin';
import { validateSession } from '@/lib/auth-session';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function requireAdmin(cookies: Parameters<APIRoute>[0]['cookies']) {
  const { session } = await validateSession(cookies);
  if (!session.isAuthenticated || !session.user) {
    return { error: json({ error: 'Not authenticated' }, 401) };
  }
  if (!session.user.email || !isAdminEmail(session.user.email)) {
    return { error: json({ error: 'Forbidden' }, 403) };
  }
  return { email: session.user.email };
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const auth = await requireAdmin(cookies);
  if (auth.error) return auth.error;

  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? '0'), 0);

  const { links, total } = await listShortLinks(limit, offset);
  return json({ links, total, limit, offset }, 200);
};

export const POST: APIRoute = async ({ cookies, request, url }) => {
  const auth = await requireAdmin(cookies);
  if (auth.error) return auth.error;

  let body: { url?: string; label?: string; alias?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const targetUrl = (body.url ?? '').trim();
  if (!targetUrl) return json({ error: 'Missing url' }, 400);

  // Only shorten links back to our own site — never let this become an open
  // redirector to arbitrary external hosts.
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return json({ error: 'Invalid url' }, 400);
  }
  if (parsed.origin !== url.origin) {
    return json({ error: 'URL must point to this site' }, 400);
  }

  try {
    const link = await createShortLink({
      url: targetUrl,
      label: body.label,
      alias: body.alias?.trim() || undefined,
      createdBy: auth.email,
    });
    return json({ ...link, shortUrl: `${url.origin}/s/${link.code}` }, 201);
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
  const auth = await requireAdmin(cookies);
  if (auth.error) return auth.error;

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
  const auth = await requireAdmin(cookies);
  if (auth.error) return auth.error;

  const code = (url.searchParams.get('code') ?? '').trim();
  if (!code) return json({ error: 'Missing code' }, 400);

  await deleteShortLink(code);
  return json({ ok: true }, 200);
};
