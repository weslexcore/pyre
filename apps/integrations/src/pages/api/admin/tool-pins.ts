// Per-user pinned tools on the /admin dashboard (the Pinned section at the
// top, and the Pinned group in the nav menu). One PUT accepting the caller's
// complete ordered pin list:
//   { hrefs: string[] } — upserts admin_tool_pins with sort_order = array
//                         position and deletes rows not in the list; [] means
//                         unpin everything.
// The client always sends the complete order (not a delta), so positions
// self-normalize and concurrent tabs are last-write-wins. Any user with
// dashboard access may pin the tools they can view; pins are personal, keyed
// by the session email. Returns the saved list so the client can just replace
// its state (the sop-pins convention). CSRF-guarded in-route like every
// cookie-authed mutation (see astro.config.mjs).

import type { APIRoute } from 'astro';
import { toolsForAccess } from '@/components/admin/adminTools';
import { assertSameOrigin, requireStaff } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

// Sanity bound far above the size of the tool directory.
const MAX_PINS = 50;

export const PUT: APIRoute = async ({ cookies, request }) => {
  const gate = await requireStaff(cookies);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const email = (gate.user.email ?? '').toLowerCase();
  if (!email) return json({ error: 'Session has no email' }, 400);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  // Only tools the caller may view are pinnable — the same filtered list the
  // dashboard renders their cards from.
  const viewable = new Set(toolsForAccess(gate.access).map((tool) => tool.href));
  const hrefs = body.hrefs;
  if (
    !Array.isArray(hrefs) ||
    hrefs.length > MAX_PINS ||
    !hrefs.every((href): href is string => typeof href === 'string' && viewable.has(href)) ||
    new Set(hrefs).size !== hrefs.length
  ) {
    return json({ error: 'hrefs must be unique hrefs of tools you can view' }, 400);
  }

  // Two statements, no transaction: a failure between them leaves extra rows
  // behind, which the next complete-list PUT cleans up.
  if (hrefs.length > 0) {
    const { error } = await db.from('admin_tool_pins').upsert(
      hrefs.map((tool_href, index) => ({ user_email: email, tool_href, sort_order: index })),
      { onConflict: 'user_email,tool_href' }
    );
    if (error) return json({ error: error.message }, 500);
  }

  let stale = db.from('admin_tool_pins').delete().eq('user_email', email);
  if (hrefs.length > 0) {
    stale = stale.not('tool_href', 'in', `(${hrefs.map((href) => `"${href}"`).join(',')})`);
  }
  const { error: staleError } = await stale;
  if (staleError) return json({ error: staleError.message }, 500);

  const { data: pins, error: pinsError } = await db
    .from('admin_tool_pins')
    .select('tool_href')
    .eq('user_email', email)
    .order('sort_order', { ascending: true })
    .order('tool_href', { ascending: true });
  if (pinsError) return json({ error: pinsError.message }, 500);

  return json({ ok: true, hrefs: (pins ?? []).map((pin) => pin.tool_href as string) });
};
