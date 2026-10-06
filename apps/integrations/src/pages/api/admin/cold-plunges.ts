// The cold plunges the water log tracks (/admin/water/plunges).
//   GET                          — every plunge, archived included, in order,
//                                  with how many log entries each has
//   POST   { name, gallons }     — add a plunge, placed last
//   PATCH  { id, …changes }      — rename, resize, archive / restore
//   PATCH  { order: [ids] }      — re-order
//   DELETE ?id=                  — remove a plunge with no log entries
//
// Reading is open to anyone with the water log (the entry form needs names
// and gallons to size doses). Everything else is admin-only. Ids are
// permanent — log entries store them — so a plunge with history is archived,
// never deleted.

import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/auth/admin';
import type { ColdPlungeRow } from '@/lib/db';
import { beginDelete, beginMutation, beginRead, type Db, dbError, json } from '@/lib/http/route';
import {
  normalizePlungeCreate,
  normalizePlungeOrder,
  normalizePlungePatch,
  PLUNGE_ID_RE,
  uniquePlungeId,
} from '@/lib/water/plunges';

const WATER_PAGE = '/admin/water';

async function loadPlunges(db: Db): Promise<ColdPlungeRow[]> {
  const { data, error } = await db
    .from('cold_plunges')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ColdPlungeRow[];
}

/** Log entries per plunge id. */
async function countEntries(db: Db, ids: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  await Promise.all(
    ids.map(async (id) => {
      const { count, error } = await db
        .from('water_tests')
        .select('id', { count: 'exact', head: true })
        .eq('tub', id);
      if (error) throw new Error(error.message);
      counts[id] = count ?? 0;
    })
  );
  return counts;
}

export const GET: APIRoute = async ({ cookies }) => {
  const ready = await beginRead(cookies, WATER_PAGE);
  if (ready instanceof Response) return ready;

  try {
    const plunges = await loadPlunges(ready.db);
    const entries = ready.gate.access.isAdmin
      ? await countEntries(
          ready.db,
          plunges.map((p) => p.id)
        )
      : {};
    return json({ plunges, entries, canManage: ready.gate.access.isAdmin });
  } catch (e) {
    console.error('[cold-plunges] read failed:', e instanceof Error ? e.message : e);
    return json({ error: 'Could not load the plunges' }, 500);
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, requireAdmin);
  if (ready instanceof Response) return ready;
  const { db, email, body } = ready;

  const normalized = normalizePlungeCreate(body);
  if (!normalized.ok) return json({ error: normalized.error }, 400);

  let existing: ColdPlungeRow[];
  try {
    existing = await loadPlunges(db);
  } catch {
    return json({ error: 'Could not load the plunges' }, 500);
  }
  const id = uniquePlungeId(
    normalized.value.name,
    existing.map((p) => p.id)
  );
  const lastOrder = existing.reduce((max, p) => Math.max(max, p.sort_order), -1);

  const { data, error } = await db
    .from('cold_plunges')
    .insert({ id, ...normalized.value, sort_order: lastOrder + 1, created_by: email })
    .select('*')
    .single();
  if (error) {
    return dbError(error, `A plunge named "${normalized.value.name}" already exists`);
  }

  return json({ plunge: data as ColdPlungeRow }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, requireAdmin);
  if (ready instanceof Response) return ready;
  const { db, body } = ready;

  // A re-order: the complete list in its new order. Plunges left out keep
  // their old position, so a stale client can't drop one off the end.
  if ('order' in body) {
    let plunges: ColdPlungeRow[];
    try {
      plunges = await loadPlunges(db);
    } catch {
      return json({ error: 'Could not load the plunges' }, 500);
    }
    const order = normalizePlungeOrder(
      body.order,
      plunges.map((p) => p.id)
    );
    if (!order) return json({ error: 'order must list plunge ids' }, 400);

    for (const [index, id] of order.entries()) {
      const { error } = await db.from('cold_plunges').update({ sort_order: index }).eq('id', id);
      if (error) return dbError(error);
    }
    return json({ plunges: await loadPlunges(db) });
  }

  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!PLUNGE_ID_RE.test(id)) return json({ error: 'id is required' }, 400);

  const normalized = normalizePlungePatch(body);
  if (!normalized.ok) return json({ error: normalized.error }, 400);

  const { data, error } = await db
    .from('cold_plunges')
    .update(normalized.value)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) {
    return dbError(error, 'Another active plunge already has that name');
  }
  if (!data) return json({ error: 'Plunge not found' }, 404);

  return json({ plunge: data as ColdPlungeRow });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const ready = await beginDelete(cookies, request, requireAdmin);
  if (ready instanceof Response) return ready;
  const { db } = ready;

  const id = (url.searchParams.get('id') ?? '').trim();
  if (!PLUNGE_ID_RE.test(id)) return json({ error: 'id is required' }, 400);

  // Deleting a plunge must never delete its history. One with log entries is
  // archived instead, which keeps them in the log, the charts, and the CSV.
  let inUse: number;
  try {
    inUse = (await countEntries(db, [id]))[id] ?? 0;
  } catch {
    return json({ error: 'Could not check the plunge’s log entries' }, 500);
  }
  if (inUse > 0) {
    return json(
      {
        error: `This plunge has ${inUse} log ${inUse === 1 ? 'entry' : 'entries'}. Archive it instead — its history stays in the log.`,
      },
      409
    );
  }

  const { error } = await db.from('cold_plunges').delete().eq('id', id);
  if (error) return dbError(error);

  return json({ ok: true });
};
