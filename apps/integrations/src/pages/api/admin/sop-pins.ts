// Pin/unpin an SOP for the calling user (the Pinned strip on /admin/sops).
// PUT {sopId, pinned} — anyone with the SOPs page grant may pin any document
// they can view; pins are personal, keyed by the session email. Returns the
// caller's full pin list so the client can just replace its state.

import type { APIRoute } from 'astro';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import { getDb, type SopRow } from '@/lib/db';
import { canViewSop } from '@/lib/sops/levels';
import { getSopRole } from '@/lib/sops/role';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PUT: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, '/admin/sops');
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

  const sopId = typeof body.sopId === 'string' ? body.sopId : '';
  if (!UUID_RE.test(sopId)) return json({ error: 'sopId must be a UUID' }, 400);
  if (typeof body.pinned !== 'boolean') return json({ error: 'pinned must be a boolean' }, 400);

  if (body.pinned) {
    const { data: sopData, error: sopError } = await db
      .from('sops')
      .select('*')
      .eq('id', sopId)
      .maybeSingle();
    if (sopError) return json({ error: sopError.message }, 500);
    const sop = (sopData as SopRow) ?? null;
    const role = await getSopRole(gate.user.email ?? null, gate.access);
    if (!sop || !canViewSop(role, sop)) return json({ error: 'SOP not found' }, 404);

    const { error } = await db
      .from('sop_pins')
      .upsert({ user_email: email, sop_id: sopId }, { ignoreDuplicates: true });
    if (error) return json({ error: error.message }, 500);
  } else {
    const { error } = await db
      .from('sop_pins')
      .delete()
      .eq('user_email', email)
      .eq('sop_id', sopId);
    if (error) return json({ error: error.message }, 500);
  }

  const { data: pins, error: pinsError } = await db
    .from('sop_pins')
    .select('sop_id')
    .eq('user_email', email);
  if (pinsError) return json({ error: pinsError.message }, 500);

  return json({ ok: true, pins: (pins ?? []).map((p) => p.sop_id as string) });
};
