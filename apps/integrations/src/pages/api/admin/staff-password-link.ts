// /admin/users "Send set-password link": emails a staff member a one-time link
// to set (or reset) their Supabase password — for people who never signed in
// through Momence during the cutover, or who are locked out. Admin-only,
// CSRF-guarded.

import type { APIRoute } from 'astro';
import { listStaff } from '@/lib/auth/access';
import { assertSameOrigin, requireAdmin } from '@/lib/auth/admin';
import { sendPasswordLink } from '@/lib/auth/provision';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export const POST: APIRoute = async ({ cookies, request, url }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const id = String(body.id ?? '');
  if (!id) return json({ error: 'Missing id' }, 400);

  const row = (await listStaff(true))?.find((r) => r.id === id);
  if (!row) return json({ error: 'No such person' }, 404);
  if (!row.email) return json({ error: 'This person has no login email' }, 400);

  const result = await sendPasswordLink(row.email, url.origin);
  if (result === 'no-access') {
    return json({ error: 'This person has no dashboard access to sign in to' }, 400);
  }
  if (result === 'not-sent') {
    return json({ error: 'The email could not be sent. Check the email log.' }, 502);
  }
  return json({ ok: true });
};
