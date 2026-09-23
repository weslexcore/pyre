// The duty list behind the schedule board's picker (/admin/schedule/duties).
//   GET                              — every duty, archived included, in shift
//                                      order; with how many assignments hold
//                                      each, for anyone who may manage
//   POST   { label, phase, … }       — add a duty, placed last in its phase
//   PATCH  { key, …changes }         — rename, re-describe, re-link the SOP,
//                                      move phase / side / in-session default,
//                                      archive / restore
//   PATCH  { order: [keys] }         — re-order
//   DELETE ?key=                     — remove a duty no assignment holds
//
// Reading is open to anyone with the schedule page (the board needs the
// labels). Everything else needs schedule:manage — the same permission as
// assigning the duties. Keys are permanent (every assignment's duties[] array
// stores them), so a duty in use is archived rather than deleted: it stops
// being offered but stays readable on the shifts that already hold it.

import type { ShiftDutyRow } from '@pyre/schedule-core';
import type { APIRoute } from 'astro';
import { hasScheduleManage } from '@/components/admin/adminTools';
import {
  type AdminGate,
  assertSameOrigin,
  requirePage,
  requireScheduleManage,
} from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import { invalidateDutyCatalog, loadDutyCatalog } from '@/lib/schedule/duties';
import {
  DUTY_KEY_RE,
  normalizeDutyCreate,
  normalizeDutyOrder,
  normalizeDutyPatch,
} from '@/lib/schedule/duty-validate';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

type Db = NonNullable<ReturnType<typeof getDb>>;

const COLUMNS = 'key, label, detail, phase, side, session_default, sop_id, sort_order, archived';

const emailOf = (gate: AdminGate): string => (gate.user.email ?? '').trim().toLowerCase();

async function gateMutation(
  cookies: Parameters<APIRoute>[0]['cookies'],
  request: Request
): Promise<AdminGate | Response> {
  const gate = await requireScheduleManage(cookies);
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  return gate;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | Response> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
}

/** Every row, straight from the table — the editor needs sop_id, not just the slug. */
async function loadRows(db: Db): Promise<ShiftDutyRow[] | Response> {
  const { data, error } = await db.from('shift_duties').select(COLUMNS);
  if (error) return json({ error: error.message }, 500);
  return (data ?? []) as ShiftDutyRow[];
}

/** Fresh catalog after a write (the cached one is up to 30s stale). */
async function freshCatalog(db: Db) {
  invalidateDutyCatalog();
  return loadDutyCatalog(db);
}

/** Assignments (live or draft) and open-or-past sub requests holding `key`. */
async function countUses(db: Db, key: string): Promise<number> {
  const [assignments, subs] = await Promise.all([
    db
      .from('shift_assignments')
      .select('id', { count: 'exact', head: true })
      .contains('duties', [key]),
    db.from('sub_requests').select('id', { count: 'exact', head: true }).contains('duties', [key]),
  ]);
  return (assignments.count ?? 0) + (subs.count ?? 0);
}

async function checkSop(db: Db, sopId: string | null | undefined): Promise<Response | null> {
  if (!sopId) return null;
  const { data, error } = await db.from('sops').select('id').eq('id', sopId).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  return data ? null : json({ error: 'That SOP does not exist' }, 400);
}

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requirePage(cookies, '/admin/schedule');
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const rows = await loadRows(db);
  if (rows instanceof Response) return rows;
  const catalog = await freshCatalog(db);
  const sopIds = new Map(rows.map((r) => [r.key, r.sop_id]));
  const canManage = hasScheduleManage(gate.access);

  // For the editor: how many assignments hold each duty (delete vs archive),
  // and the SOPs a duty can link to. The SOP list is served here rather than
  // from /api/admin/sops so managing duties doesn't need the library grant.
  const uses: Record<string, number> = {};
  let sops: Array<{ id: string; slug: string; title: string; category: string | null }> = [];
  if (canManage) {
    const [counts, sopRes] = await Promise.all([
      Promise.all(catalog.map((d) => countUses(db, d.key))),
      db
        .from('sops')
        .select('id, slug, title, category')
        .eq('archived', false)
        .order('title', { ascending: true }),
    ]);
    catalog.forEach((d, i) => {
      uses[d.key] = counts[i];
    });
    sops = (sopRes.data ?? []) as typeof sops;
  }

  return json({
    duties: catalog.map((d) => ({ ...d, sopId: sopIds.get(d.key) ?? null })),
    uses,
    sops,
    canManage,
  });
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await gateMutation(cookies, request);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const catalog = await freshCatalog(db);
  const normalized = normalizeDutyCreate(body, catalog);
  if (!normalized.ok) return json({ error: normalized.error }, 400);
  const badSop = await checkSop(db, normalized.value.sop_id);
  if (badSop) return badSop;

  // Last in its phase: after every duty that already has a position.
  const sortOrder = catalog.reduce((max, d) => Math.max(max, d.sortOrder), 0) + 10;
  const email = emailOf(gate);
  const { error } = await db.from('shift_duties').insert({
    ...normalized.value,
    sort_order: sortOrder,
    created_by: email,
    updated_by: email,
  });
  if (error) {
    // Two admins adding the same label at once, or racing a side.
    if (error.code === '23505') return json({ error: 'That duty or side already exists' }, 409);
    return json({ error: error.message }, 500);
  }

  invalidateDutyCatalog();
  return json({ key: normalized.value.key }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const gate = await gateMutation(cookies, request);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const email = emailOf(gate);
  const now = new Date().toISOString();

  // A re-order: every key in its new order. Order within a phase is what
  // shows; the numbers are global so moving phase keeps a sensible spot.
  if ('order' in body) {
    const catalog = await freshCatalog(db);
    const order = normalizeDutyOrder(
      body.order,
      catalog.map((d) => d.key)
    );
    if (!order) return json({ error: 'order must list duty keys' }, 400);
    for (const [index, key] of order.entries()) {
      const { error } = await db
        .from('shift_duties')
        .update({ sort_order: (index + 1) * 10, updated_by: email, updated_at: now })
        .eq('key', key);
      if (error) return json({ error: error.message }, 500);
    }
    invalidateDutyCatalog();
    return json({ ok: true });
  }

  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (!DUTY_KEY_RE.test(key)) return json({ error: 'key is required' }, 400);

  const rows = await loadRows(db);
  if (rows instanceof Response) return rows;
  const existing = rows.find((r) => r.key === key);
  if (!existing) return json({ error: 'Duty not found' }, 404);

  const normalized = normalizeDutyPatch(body, existing, await freshCatalog(db));
  if (!normalized.ok) return json({ error: normalized.error }, 400);
  const badSop = await checkSop(db, normalized.value.sop_id);
  if (badSop) return badSop;

  const { error } = await db
    .from('shift_duties')
    .update({ ...normalized.value, updated_by: email, updated_at: now })
    .eq('key', key);
  if (error) {
    if (error.code === '23505') return json({ error: 'Another duty already holds that side' }, 409);
    return json({ error: error.message }, 500);
  }

  invalidateDutyCatalog();
  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const gate = await gateMutation(cookies, request);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const key = (url.searchParams.get('key') ?? '').trim();
  if (!DUTY_KEY_RE.test(key)) return json({ error: 'key is required' }, 400);

  // Deleting a duty must never rewrite anyone's shift. One that's been
  // assigned is archived instead, which keeps it readable where it's held.
  const uses = await countUses(db, key);
  if (uses > 0) {
    return json(
      {
        error: `${uses} assignment${uses === 1 ? ' holds' : 's hold'} this duty. Archive it instead — it stays readable on those shifts.`,
      },
      409
    );
  }

  const { error } = await db.from('shift_duties').delete().eq('key', key);
  if (error) return json({ error: error.message }, 500);

  invalidateDutyCatalog();
  return json({ ok: true });
};
