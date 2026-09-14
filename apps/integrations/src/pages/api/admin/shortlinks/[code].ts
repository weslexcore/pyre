// One standalone short link: PATCH renames its note; DELETE removes it, after
// which the /s/<code> URL redirects home. Short links a campaign link owns are
// managed from the campaign page and refused here, so deleting one can never
// leave a campaign link pointing at a code that no longer exists.

import { deleteShortLink, getShortLink, updateShortLinkLabel } from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import { SHORT_LINK_LIMITS } from '@/lib/shortlinks/alias';
import { listStandaloneShortLinks } from '@/lib/shortlinks/server';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** The standalone record for `code`, or null when it is missing or campaign-owned. */
async function standalone(code: string) {
  if (!code || !(await getShortLink(code))) return null;
  const { links } = await listStandaloneShortLinks();
  return links.find((l) => l.code === code) ?? null;
}

export const PATCH: APIRoute = async ({ cookies, params, request }) => {
  const gate = await requirePage(cookies, '/admin/campaigns');
  if (gate instanceof Response) return gate;
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

  let body: { label?: unknown };
  try {
    body = (await request.json()) as { label?: unknown };
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (typeof body.label !== 'string') return json({ error: 'label is required' }, 400);

  try {
    const link = await standalone(params.code ?? '');
    if (!link) return json({ error: 'not_found' }, 404);
    const label = body.label.trim().slice(0, SHORT_LINK_LIMITS.label);
    const updated = await updateShortLinkLabel(link.code, label);
    if (!updated) return json({ error: 'not_found' }, 404);
    return json({ link: { ...link, label: updated.label } });
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
    const link = await standalone(params.code ?? '');
    if (!link) return json({ error: 'not_found' }, 404);
    await deleteShortLink(link.code);
    return json({ ok: true });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
};
