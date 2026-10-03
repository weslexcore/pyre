// Inventory counts API for the /admin/inventory/count tab.
//
//   GET                         → CountsOverview: areas with due status,
//                                 open rounds with progress, and (admins) the
//                                 review list and thresholds
//   GET ?areaId=&countId=       → CountSheet: one area's items in shelf order,
//   GET ?areaId=&since=           in a round, or a one-off count of the area
//                                 since the screen opened. Blind: a spot
//                                 nobody has counted yet carries no expected
//                                 number.
//   GET ?summary=<countId>      → CountSummary: a round's results
//   POST {action:'start'}       → open a round over some areas
//   POST {action:'line'}        → save one counted spot (inventory_record_count
//                                 posts the difference to the ledger)
//   PATCH {action:'close'}      → close a round (anyone counting)
//   PATCH {action:'cancel'}     → cancel a round (admins)
//   PATCH {action:'review'}     → accept a line or ask for a recount (admins)
//   PATCH {action:'settings'}   → review thresholds (admins)
//
// Anyone granted /admin/inventory may count; the review list, thresholds,
// and cancelling a round are admin-only. Identity (started_by, counted_by,
// closed_by, reviewed_by) is always the session email.

import type { APIRoute } from 'astro';
import { beginMutation, beginRead, type Db, dbError, isUuid, json } from '@/lib/http/route';
import { itemTotal, notifyIfLow } from '@/lib/inventory/alerts';
import { areaDueStatus, countTotals, DEFAULT_SETTINGS, DUE_ORDER } from '@/lib/inventory/counts';
import { parseQuantity } from '@/lib/inventory/rules';
import {
  type CountSheet,
  type CountSheetRow,
  type CountSummary,
  type CountsOverview,
  INVENTORY_HREF,
  type InventoryAreaRow,
  type InventoryCategoryRow,
  type InventoryCountLineRow,
  type InventoryCountRow,
  type InventoryItemRow,
  type InventorySettings,
  type InventorySpotRow,
} from '@/lib/inventory/types';
import { getPeopleNames } from '@/lib/sops/people';

const NAME_MAX = 80;
const MAX_AREAS = 100;
// How far back "last counted" looks; an area older than this reads as never.
const LAST_COUNTED_DAYS = 400;
const REVIEW_LIMIT = 100;

const numericLine = (line: InventoryCountLineRow): InventoryCountLineRow => ({
  ...line,
  counted_qty: Number(line.counted_qty),
  expected_qty: Number(line.expected_qty),
  variance: Number(line.variance),
});

async function loadSettings(db: Db): Promise<InventorySettings> {
  const { data } = await db
    .from('inventory_settings')
    .select('review_pct, review_cents')
    .maybeSingle();
  if (!data) return DEFAULT_SETTINGS;
  const row = data as InventorySettings;
  return { review_pct: Number(row.review_pct), review_cents: Number(row.review_cents) };
}

/** Active areas, active items, and where those items are placed. */
async function loadCatalogue(db: Db) {
  const [areas, items, spots, categories] = await Promise.all([
    db.from('inventory_areas').select('*').eq('active', true).order('sort_order').order('name'),
    db.from('inventory_items').select('*').eq('active', true),
    db.from('inventory_item_spots').select('*'),
    db.from('inventory_categories').select('id, name'),
  ]);
  for (const result of [areas, items, spots, categories]) {
    if (result.error) return { error: result.error };
  }
  const itemById = new Map(((items.data ?? []) as InventoryItemRow[]).map((i) => [i.id, i]));
  const areaList = (areas.data ?? []) as InventoryAreaRow[];
  const areaIds = new Set(areaList.map((a) => a.id));
  return {
    areas: areaList,
    areaById: new Map(areaList.map((a) => [a.id, a])),
    itemById,
    categoryName: new Map(
      ((categories.data ?? []) as Pick<InventoryCategoryRow, 'id' | 'name'>[]).map((c) => [
        c.id,
        c.name,
      ])
    ),
    // Only spots for active items in active areas are countable.
    spots: ((spots.data ?? []) as InventorySpotRow[]).filter(
      (s) => itemById.has(s.item_id) && areaIds.has(s.area_id)
    ),
  };
}

type Catalogue = Exclude<Awaited<ReturnType<typeof loadCatalogue>>, { error: unknown }>;

const spotKey = (itemId: string, areaId: string) => `${itemId}:${areaId}`;

async function overview(db: Db, isAdmin: boolean): Promise<CountsOverview | Response> {
  const catalogue = await loadCatalogue(db);
  if ('error' in catalogue && catalogue.error) return dbError(catalogue.error);
  const cat = catalogue as Catalogue;

  const since = new Date(Date.now() - LAST_COUNTED_DAYS * 86_400_000).toISOString();
  const [recentLines, openRounds, settings] = await Promise.all([
    db
      .from('inventory_count_lines')
      .select('area_id, counted_at')
      .gte('counted_at', since)
      .order('counted_at', { ascending: false })
      .limit(5000),
    db
      .from('inventory_counts')
      .select('*')
      .eq('status', 'open')
      .order('started_at', { ascending: false }),
    loadSettings(db),
  ]);
  if (recentLines.error) return dbError(recentLines.error);
  if (openRounds.error) return dbError(openRounds.error);

  const lastCounted = new Map<string, string>();
  for (const row of (recentLines.data ?? []) as { area_id: string; counted_at: string }[]) {
    if (!lastCounted.has(row.area_id)) lastCounted.set(row.area_id, row.counted_at);
  }

  const spotsPerArea = new Map<string, number>();
  for (const spot of cat.spots) {
    spotsPerArea.set(spot.area_id, (spotsPerArea.get(spot.area_id) ?? 0) + 1);
  }

  const now = new Date();
  const areas = cat.areas
    .map((area) => {
      const lastCountedAt = lastCounted.get(area.id) ?? null;
      return {
        area,
        lastCountedAt,
        status: areaDueStatus(lastCountedAt, area.count_every_days, now),
        spotCount: spotsPerArea.get(area.id) ?? 0,
      };
    })
    .sort(
      (a, b) => DUE_ORDER[a.status] - DUE_ORDER[b.status] || a.area.sort_order - b.area.sort_order
    );

  // Progress of each open round: counted lines over countable spots.
  const rounds = (openRounds.data ?? []) as InventoryCountRow[];
  let roundLines: InventoryCountLineRow[] = [];
  if (rounds.length > 0) {
    const { data, error } = await db
      .from('inventory_count_lines')
      .select('*')
      .in(
        'count_id',
        rounds.map((r) => r.id)
      );
    if (error) return dbError(error);
    roundLines = (data ?? []) as InventoryCountLineRow[];
  }
  const roundViews = rounds.map((round) => {
    const areaSet = new Set(round.area_ids);
    const lines = roundLines.filter((l) => l.count_id === round.id);
    return {
      round,
      counted: lines.length,
      total: cat.spots.filter((s) => areaSet.has(s.area_id)).length,
      people: [...new Set(lines.map((l) => l.counted_by))],
    };
  });

  let review: CountsOverview['review'] = [];
  if (isAdmin) {
    const { data, error } = await db
      .from('inventory_count_lines')
      .select('*')
      .in('review_status', ['pending', 'recount'])
      .order('counted_at', { ascending: false })
      .limit(REVIEW_LIMIT);
    if (error) return dbError(error);
    review = ((data ?? []) as InventoryCountLineRow[]).map((line) => {
      const item = cat.itemById.get(line.item_id);
      return {
        ...numericLine(line),
        itemName: item?.name ?? 'Retired item',
        unit: item?.unit ?? '',
        unit_plural: item?.unit_plural ?? '',
        areaName: cat.areaById.get(line.area_id)?.name ?? 'Retired area',
      };
    });
  }

  const people = await getPeopleNames([
    ...roundViews.flatMap((r) => [r.round.started_by, ...r.people]),
    ...review.map((l) => l.counted_by),
  ]);

  return { areas, rounds: roundViews, review, settings, people, isAdmin };
}

async function sheet(
  db: Db,
  areaId: string,
  countId: string | null,
  since: string | null
): Promise<CountSheet | Response> {
  const catalogue = await loadCatalogue(db);
  if ('error' in catalogue && catalogue.error) return dbError(catalogue.error);
  const cat = catalogue as Catalogue;
  const area = cat.areaById.get(areaId);
  if (!area) return json({ error: 'Storage area not found' }, 404);

  let round: InventoryCountRow | null = null;
  let query = db.from('inventory_count_lines').select('*').eq('area_id', areaId);
  if (countId) {
    const { data, error } = await db
      .from('inventory_counts')
      .select('*')
      .eq('id', countId)
      .maybeSingle();
    if (error) return dbError(error);
    round = (data as InventoryCountRow | null) ?? null;
    if (!round) return json({ error: 'Count round not found' }, 404);
    if (!round.area_ids.includes(areaId)) {
      return json({ error: 'That area is not part of this count round' }, 400);
    }
    query = query.eq('count_id', countId);
  } else {
    // A one-off count: the lines entered since this counting screen opened.
    query = query.is('count_id', null).gte('counted_at', since ?? new Date().toISOString());
  }
  const { data: lineData, error: lineError } = await query.order('counted_at', { ascending: true });
  if (lineError) return dbError(lineError);

  // Spots an admin asked to have counted again, whichever round asked.
  const { data: recountData, error: recountError } = await db
    .from('inventory_count_lines')
    .select('item_id')
    .eq('area_id', areaId)
    .eq('review_status', 'recount');
  if (recountError) return dbError(recountError);
  const recountItems = new Set(
    ((recountData ?? []) as { item_id: string }[]).map((r) => r.item_id)
  );

  // Latest line per spot (a one-off count can save the same spot twice).
  const lineBySpot = new Map<string, InventoryCountLineRow>();
  for (const line of (lineData ?? []) as InventoryCountLineRow[]) {
    lineBySpot.set(spotKey(line.item_id, line.area_id), numericLine(line));
  }

  const rows: CountSheetRow[] = cat.spots
    .filter((s) => s.area_id === areaId)
    .sort((a, b) => {
      const nameA = cat.itemById.get(a.item_id)?.name ?? '';
      const nameB = cat.itemById.get(b.item_id)?.name ?? '';
      return a.sort_order - b.sort_order || nameA.localeCompare(nameB);
    })
    .map((spot) => {
      const item = cat.itemById.get(spot.item_id) as InventoryItemRow;
      return {
        itemId: item.id,
        name: item.name,
        unit: item.unit,
        unit_plural: item.unit_plural,
        category: item.category_id ? (cat.categoryName.get(item.category_id) ?? '') : '',
        line: lineBySpot.get(spotKey(item.id, areaId)) ?? null,
        recountAsked: recountItems.has(item.id),
      };
    });

  const people = await getPeopleNames(rows.flatMap((r) => (r.line ? [r.line.counted_by] : [])));
  return { area, round, rows, people };
}

async function summary(db: Db, countId: string): Promise<CountSummary | Response> {
  const { data: roundData, error: roundError } = await db
    .from('inventory_counts')
    .select('*')
    .eq('id', countId)
    .maybeSingle();
  if (roundError) return dbError(roundError);
  const round = roundData as InventoryCountRow | null;
  if (!round) return json({ error: 'Count round not found' }, 404);

  const catalogue = await loadCatalogue(db);
  if ('error' in catalogue && catalogue.error) return dbError(catalogue.error);
  const cat = catalogue as Catalogue;

  const { data, error } = await db
    .from('inventory_count_lines')
    .select('*')
    .eq('count_id', countId)
    .order('counted_at', { ascending: true });
  if (error) return dbError(error);
  const rawLines = ((data ?? []) as InventoryCountLineRow[]).map(numericLine);
  const counted = new Set(rawLines.map((l) => spotKey(l.item_id, l.area_id)));

  const areas = round.area_ids
    .map((id) => cat.areaById.get(id))
    .filter((a): a is InventoryAreaRow => !!a)
    .map((area) => ({
      area,
      counted: rawLines.filter((l) => l.area_id === area.id).length,
      total: cat.spots.filter((s) => s.area_id === area.id).length,
    }));

  const notCounted = cat.spots
    .filter(
      (s) => round.area_ids.includes(s.area_id) && !counted.has(spotKey(s.item_id, s.area_id))
    )
    .map((s) => ({
      itemName: cat.itemById.get(s.item_id)?.name ?? '',
      areaName: cat.areaById.get(s.area_id)?.name ?? '',
    }));

  const lines = rawLines.map((line) => {
    const item = cat.itemById.get(line.item_id);
    return {
      ...line,
      itemName: item?.name ?? 'Retired item',
      unit: item?.unit ?? '',
      unit_plural: item?.unit_plural ?? '',
      areaName: cat.areaById.get(line.area_id)?.name ?? 'Retired area',
    };
  });

  const people = await getPeopleNames([
    round.started_by,
    round.closed_by ?? '',
    ...lines.map((l) => l.counted_by),
  ]);
  return { round, areas, lines, notCounted, totals: countTotals(lines), people };
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const ready = await beginRead(cookies, INVENTORY_HREF);
  if (ready instanceof Response) return ready;
  const { gate, db } = ready;

  const summaryId = url.searchParams.get('summary');
  if (summaryId) {
    if (!isUuid(summaryId)) return json({ error: 'summary must be a count id' }, 400);
    const body = await summary(db, summaryId);
    return body instanceof Response ? body : json(body);
  }

  const areaId = url.searchParams.get('areaId');
  if (areaId) {
    if (!isUuid(areaId)) return json({ error: 'areaId must be a UUID' }, 400);
    const countId = url.searchParams.get('countId');
    if (countId && !isUuid(countId)) return json({ error: 'countId must be a UUID' }, 400);
    const since = url.searchParams.get('since');
    if (since && Number.isNaN(Date.parse(since)))
      return json({ error: 'since must be a date' }, 400);
    const body = await sheet(db, areaId, countId, since ? new Date(since).toISOString() : null);
    return body instanceof Response ? body : json(body);
  }

  const body = await overview(db, gate.access.isAdmin);
  return body instanceof Response ? body : json(body);
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, INVENTORY_HREF);
  if (ready instanceof Response) return ready;
  const { db, email, body } = ready;

  if (body.action === 'start') {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > NAME_MAX) {
      return json({ error: `Give the round a name (max ${NAME_MAX} characters)` }, 400);
    }
    const ids = Array.isArray(body.areaIds) ? [...new Set(body.areaIds)] : [];
    if (ids.length === 0 || ids.length > MAX_AREAS || !ids.every(isUuid)) {
      return json({ error: 'Choose at least one area to count' }, 400);
    }
    const { data: areas, error: areaError } = await db
      .from('inventory_areas')
      .select('id')
      .eq('active', true)
      .in('id', ids as string[]);
    if (areaError) return dbError(areaError);
    if ((areas ?? []).length !== ids.length) {
      return json({ error: 'One of the storage areas no longer exists' }, 400);
    }
    const { data, error } = await db
      .from('inventory_counts')
      .insert({ name, area_ids: ids, started_by: email })
      .select('*')
      .single();
    if (error) return dbError(error);
    return json({ round: data as InventoryCountRow }, 201);
  }

  if (body.action === 'line') {
    if (body.countId != null && !isUuid(body.countId)) {
      return json({ error: 'countId must be a UUID' }, 400);
    }
    if (!isUuid(body.itemId)) return json({ error: 'itemId must be a UUID' }, 400);
    if (!isUuid(body.areaId)) return json({ error: 'areaId must be a UUID' }, 400);
    // Zero is a real count (the shelf is empty); parseQuantity rejects it.
    const counted = body.counted === 0 || body.counted === '0' ? 0 : parseQuantity(body.counted);
    if (counted == null) return json({ error: 'Enter how many are on the shelf (0 or more)' }, 400);

    // The total before the count, to tell whether the count took the item to
    // its re-order level (a shortfall found on the shelf alerts like a use).
    const before = await itemTotal(db, body.itemId);

    const { data, error } = await db.rpc('inventory_record_count', {
      p_count_id: body.countId ?? null,
      p_item_id: body.itemId,
      p_area_id: body.areaId,
      p_counted: counted,
      p_counted_by: email,
    });
    if (error) {
      // The function's own checks (closed round, wrong area, retired item).
      if (error.code === 'P0001') return json({ error: error.message }, 409);
      return dbError(error);
    }
    const line = numericLine(data as InventoryCountLineRow);

    if (before != null) {
      const [after, { data: item }] = await Promise.all([
        itemTotal(db, body.itemId),
        db
          .from('inventory_items')
          .select(
            'id, name, unit, unit_plural, lot_size, lot_label, lot_label_plural, reorder_level, reorder_target'
          )
          .eq('id', body.itemId)
          .maybeSingle(),
      ]);
      if (after != null && item) {
        await notifyIfLow(db, item as Parameters<typeof notifyIfLow>[1], before, after, email);
      }
    }

    return json({ line }, 201);
  }

  return json({ error: "action must be 'start' or 'line'" }, 400);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, INVENTORY_HREF);
  if (ready instanceof Response) return ready;
  const { gate, db, email, body } = ready;
  const isAdmin = gate.access.isAdmin;

  if (body.action === 'close' || body.action === 'cancel') {
    if (!isUuid(body.id)) return json({ error: 'id must be a UUID' }, 400);
    if (body.action === 'cancel' && !isAdmin) {
      return json({ error: 'Only admins can cancel a count round' }, 403);
    }
    const { data, error } = await db
      .from('inventory_counts')
      .update({
        status: body.action === 'close' ? 'closed' : 'cancelled',
        closed_by: email,
        closed_at: new Date().toISOString(),
      })
      .eq('id', body.id)
      .eq('status', 'open')
      .select('*')
      .maybeSingle();
    if (error) return dbError(error);
    if (!data) return json({ error: 'That round is not open' }, 409);
    return json({ round: data as InventoryCountRow });
  }

  if (!isAdmin) return json({ error: 'Admins only' }, 403);

  if (body.action === 'review') {
    if (!isUuid(body.lineId)) return json({ error: 'lineId must be a UUID' }, 400);
    if (body.decision !== 'accept' && body.decision !== 'recount') {
      return json({ error: "decision must be 'accept' or 'recount'" }, 400);
    }
    const { data, error } = await db
      .from('inventory_count_lines')
      .update({
        review_status: body.decision === 'accept' ? 'accepted' : 'recount',
        reviewed_by: email,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', body.lineId)
      .in('review_status', ['pending', 'recount'])
      .select('*')
      .maybeSingle();
    if (error) return dbError(error);
    if (!data) return json({ error: 'That line is not waiting on a review' }, 409);
    return json({ line: numericLine(data as InventoryCountLineRow) });
  }

  if (body.action === 'settings') {
    const pct = Number(body.reviewPct);
    const dollars = Number(body.reviewDollars);
    if (!Number.isFinite(pct) || pct < 0 || pct > 1000) {
      return json({ error: 'The percent must be between 0 and 1000' }, 400);
    }
    if (!Number.isFinite(dollars) || dollars < 0 || dollars > 1_000_000) {
      return json({ error: 'The dollar amount must be 0 or more' }, 400);
    }
    const { data, error } = await db
      .from('inventory_settings')
      .upsert({
        id: true,
        review_pct: Math.round(pct * 100) / 100,
        review_cents: Math.round(dollars * 100),
        updated_by: email,
      })
      .select('review_pct, review_cents')
      .single();
    if (error) return dbError(error);
    const row = data as InventorySettings;
    return json({
      settings: { review_pct: Number(row.review_pct), review_cents: Number(row.review_cents) },
    });
  }

  return json({ error: "action must be 'close', 'cancel', 'review', or 'settings'" }, 400);
};
