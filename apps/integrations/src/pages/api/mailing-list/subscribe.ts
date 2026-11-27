import type { APIRoute } from 'astro';
import { hasBearer } from '@/lib/http/bearer';
import { json } from '@/lib/http/route';
import { isMailingList, subscribeToMailingList } from '@/lib/mailing-list/subscribe';

export const prerender = false;

// Mailing-list sign-up intake. Called server-to-server by the landing page's
// /api/mailing-list route (which owns Turnstile, honeypots and rate limits),
// never by browsers, hence the shared-secret Bearer auth and no CORS.

const MAX_EMAIL_LENGTH = 254;
const MAX_SOURCE_LENGTH = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SOURCE_RE = /^[a-z0-9_-]+$/i;

export const POST: APIRoute = async ({ request }) => {
  // process.env fallback: import.meta.env inlines at build time; vars added
  // after the cached build only exist at runtime.
  const secret = import.meta.env.MAILING_LIST_API_SECRET ?? process.env.MAILING_LIST_API_SECRET;
  if (!hasBearer(request, secret, 'Mailing list')) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const list = body.list ?? 'newsletter';
  const source = typeof body.source === 'string' ? body.source.trim() : '';

  if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LENGTH) {
    return json({ error: 'Invalid email' }, 400);
  }
  if (!isMailingList(list)) {
    return json({ error: 'Unknown list' }, 400);
  }
  if (!SOURCE_RE.test(source) || source.length > MAX_SOURCE_LENGTH) {
    return json({ error: 'Invalid source' }, 400);
  }

  try {
    const result = await subscribeToMailingList({ email, list, source });
    if (result.outcome === 'unavailable') {
      return json({ ok: false, error: result.reason }, 503);
    }
    // Same answer whether or not the address is suppressed.
    return json({ ok: true, result: 'subscribed' }, 200);
  } catch (error) {
    console.error('[Mailing list] Subscribe failed', error);
    return json({ error: 'Request failed' }, 502);
  }
};
