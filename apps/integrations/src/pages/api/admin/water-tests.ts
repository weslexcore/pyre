// Cold-tub water testing log API for the /admin/water staff tool: GET lists
// entries newest-first (optionally per tub or entry type, or as a CSV download
// with ?format=csv), POST records a new entry with readings and the chemicals
// actually added, PATCH corrects an entry the caller recorded themselves (a
// reading taken after the entry was saved), DELETE removes one.
// Gated on the /admin/water page grant (requirePage), and — as the app's
// first cookie-authed mutating routes — CSRF-guarded in-route via
// assertSameOrigin plus (on POST) the JSON content-type requirement (global
// checkOrigin stays off for the Mailchimp webhook; see astro.config.mjs).

import type { APIRoute } from 'astro';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import { type DoseRecord, getDb, type WaterTestRow } from '@/lib/db';
import {
  ENTRY_TYPES,
  type EntryType,
  TEST_METHODS,
  type TestMethod,
  TUBS,
  type Tub,
} from '@/lib/water/charts';
import { waterTestsToCsv } from '@/lib/water/csv';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;
// The export ignores the paging limits — one file should hold the whole
// filtered history — but stays bounded so a runaway table can't blow the
// function's memory.
const CSV_MAX_ROWS = 5000;

// Sanity bounds only (mirrors the table's check constraints); target-range
// logic lives in src/lib/water/.
const READING_BOUNDS = {
  ta_ppm: [0, 1000],
  ph: [0, 14],
  free_chlorine_ppm: [0, 50],
  combined_chlorine_ppm: [0, 50],
  salt_ppm: [0, 20000],
} as const;

type ReadingColumn = keyof typeof READING_BOUNDS;

const READING_KEYS: Record<ReadingColumn, string> = {
  ta_ppm: 'ta',
  ph: 'ph',
  free_chlorine_ppm: 'chlorine',
  combined_chlorine_ppm: 'cc',
  salt_ppm: 'salt',
};

type ReadingColumns = Partial<Record<ReadingColumn, number | null>>;

// The body validators below are shared by POST and PATCH so a corrected entry
// can never hold a value a new entry would have rejected. Each returns either
// the parsed value or the 400 to send back.

function parseReadings(raw: unknown): ReadingColumns | Response {
  const rawReadings = (raw ?? {}) as Record<string, unknown>;
  const readings: ReadingColumns = {};
  for (const column of Object.keys(READING_BOUNDS) as ReadingColumn[]) {
    const value = rawReadings[READING_KEYS[column]];
    if (value == null) {
      readings[column] = null;
      continue;
    }
    const [min, max] = READING_BOUNDS[column];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      return json(
        { error: `${READING_KEYS[column]} must be a number between ${min} and ${max}` },
        400
      );
    }
    readings[column] = value;
  }
  return readings;
}

function parseTestMethod(raw: unknown): TestMethod | null | Response {
  if (raw == null) return null;
  if (typeof raw !== 'string' || !TEST_METHODS.includes(raw as TestMethod)) {
    return json({ error: `testMethod must be one of: ${TEST_METHODS.join(', ')}` }, 400);
  }
  return raw as TestMethod;
}

function parseDoses(raw: unknown): DoseRecord[] | Response {
  const rawDoses = raw ?? [];
  if (!Array.isArray(rawDoses) || rawDoses.length > 8) {
    return json({ error: 'doses must be an array of at most 8 items' }, 400);
  }
  const doses: DoseRecord[] = [];
  for (const item of rawDoses) {
    const d = item as Record<string, unknown>;
    const chemical = typeof d.chemical === 'string' ? d.chemical.trim() : '';
    const grams = d.grams;
    if (!chemical || chemical.length > 64) {
      return json({ error: 'each dose needs a chemical name (max 64 chars)' }, 400);
    }
    // Sanity bound only — a fresh salt fill is ~920 g, and dosing badly
    // depleted salt water can top 1 kg.
    if (typeof grams !== 'number' || !Number.isFinite(grams) || grams <= 0 || grams > 2000) {
      return json({ error: 'each dose needs grams between 0 and 2000' }, 400);
    }
    const dose: DoseRecord = { chemical, grams };
    if (typeof d.reason === 'string' && d.reason) dose.reason = d.reason.slice(0, 200);
    if (typeof d.recommended_grams === 'number' && Number.isFinite(d.recommended_grams)) {
      dose.recommended_grams = d.recommended_grams;
    }
    doses.push(dose);
  }
  return doses;
}

const parseNotes = (raw: unknown): string =>
  typeof raw === 'string' ? raw.trim().slice(0, 1000) : '';

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, '/admin/water');
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const tub = url.searchParams.get('tub');
  if (tub && !TUBS.includes(tub as Tub)) {
    return json({ error: `tub must be one of: ${TUBS.join(', ')}` }, 400);
  }

  const entryType = url.searchParams.get('entryType');
  if (entryType && !ENTRY_TYPES.includes(entryType as EntryType)) {
    return json({ error: `entryType must be one of: ${ENTRY_TYPES.join(', ')}` }, 400);
  }

  const since = url.searchParams.get('since');
  if (since && Number.isNaN(Date.parse(since))) {
    return json({ error: 'since must be an ISO date' }, 400);
  }

  // CSV export: same tub/entryType/since filters as the log, but the whole
  // matching history in one file (oldest first — a log people read
  // top-to-bottom or chart in a spreadsheet).
  if (url.searchParams.get('format') === 'csv') {
    let csvQuery = db
      .from('water_tests')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(CSV_MAX_ROWS);
    if (tub) csvQuery = csvQuery.eq('tub', tub);
    if (entryType) csvQuery = csvQuery.eq('entry_type', entryType);
    if (since) csvQuery = csvQuery.gte('created_at', since);

    const { data: csvRows, error: csvError } = await csvQuery;
    if (csvError) return json({ error: csvError.message }, 500);

    const filename = `water-log-${tub ?? 'all'}-${entryType ?? 'all'}-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(waterTestsToCsv((csvRows ?? []) as WaterTestRow[]), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const limit = Math.min(
    Math.max(Number.parseInt(url.searchParams.get('limit') ?? '', 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );
  const offset = Math.max(Number.parseInt(url.searchParams.get('offset') ?? '', 10) || 0, 0);

  let query = db
    .from('water_tests')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (tub) query = query.eq('tub', tub);
  if (entryType) query = query.eq('entry_type', entryType);
  if (since) query = query.gte('created_at', since);

  const { data, error, count } = await query;
  if (error) return json({ error: error.message }, 500);

  return json({ records: (data ?? []) as WaterTestRow[], total: count ?? 0, limit, offset });
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, '/admin/water');
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const tub = body.tub;
  if (typeof tub !== 'string' || !TUBS.includes(tub as Tub)) {
    return json({ error: `tub must be one of: ${TUBS.join(', ')}` }, 400);
  }

  const entryType = body.entryType ?? 'test';
  if (typeof entryType !== 'string' || !ENTRY_TYPES.includes(entryType as EntryType)) {
    return json({ error: `entryType must be one of: ${ENTRY_TYPES.join(', ')}` }, 400);
  }

  const readings = parseReadings(body.readings);
  if (readings instanceof Response) return readings;

  if (entryType === 'test' && Object.values(readings).every((v) => v == null)) {
    return json({ error: 'A test entry needs at least one reading' }, 400);
  }

  // Drain/refill entries record the water change only — tests are logged
  // separately, so measurements never land on a refill row.
  if (entryType === 'refill') {
    for (const column of Object.keys(readings) as ReadingColumn[]) readings[column] = null;
  }

  const parsedMethod = parseTestMethod(body.testMethod);
  if (parsedMethod instanceof Response) return parsedMethod;
  const testMethod = entryType === 'refill' ? null : parsedMethod;

  const doses = parseDoses(body.doses);
  if (doses instanceof Response) return doses;

  const notes = parseNotes(body.notes);

  const { data, error } = await db
    .from('water_tests')
    .insert({
      tub,
      entry_type: entryType,
      ...readings,
      test_method: testMethod,
      doses,
      notes: notes || null,
      // Always the authenticated session's email — never trusted from the body.
      recorded_by: gate.user.email ?? '',
    })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({ record: data as WaterTestRow }, 201);
};

/**
 * Correct an entry already in the log — the reading taken after the entry was
 * saved, the dose logged at the wrong weight, the note that needed a sentence
 * more. Readings, test method, doses and notes are editable; tub and entry
 * type are not, because changing those makes the row a different event and the
 * log is an audit record (log a new entry instead). Fields left out of the
 * body are kept as they are.
 */
export const PATCH: APIRoute = async ({ cookies, request, url }) => {
  const gate = await requirePage(cookies, '/admin/water');
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { data: existing, error: fetchError } = await db
    .from('water_tests')
    .select('id, recorded_by, entry_type')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) return json({ error: fetchError.message }, 500);
  if (!existing) return json({ error: 'Entry not found' }, 404);

  // Same rule as DELETE: the log is an audit record, so only the person who
  // wrote an entry can change it — admins included.
  const email = (gate.user.email ?? '').toLowerCase();
  if ((existing.recorded_by ?? '').toLowerCase() !== email) {
    return json({ error: 'You can only edit entries you recorded' }, 403);
  }

  const entryType = existing.entry_type as EntryType;
  const patch: Record<string, unknown> = {};

  if ('readings' in body) {
    // A refill row carries no measurements, so there is nothing to correct on
    // one — reject rather than silently dropping what the caller sent.
    if (entryType === 'refill') {
      return json({ error: 'A drain/refill entry has no readings to edit' }, 400);
    }
    const readings = parseReadings(body.readings);
    if (readings instanceof Response) return readings;
    if (entryType === 'test' && Object.values(readings).every((v) => v == null)) {
      return json({ error: 'A test entry needs at least one reading' }, 400);
    }
    Object.assign(patch, readings);
  }

  if ('testMethod' in body) {
    const testMethod = parseTestMethod(body.testMethod);
    if (testMethod instanceof Response) return testMethod;
    patch.test_method = entryType === 'refill' ? null : testMethod;
  }

  if ('doses' in body) {
    const doses = parseDoses(body.doses);
    if (doses instanceof Response) return doses;
    patch.doses = doses;
  }

  if ('notes' in body) patch.notes = parseNotes(body.notes) || null;

  if (Object.keys(patch).length === 0) {
    return json({ error: 'Nothing to update' }, 400);
  }

  // recorded_by and created_at stay put: an edit corrects what was measured,
  // it doesn't change who logged it or when. updated_at moves via trigger.
  const { data, error } = await db
    .from('water_tests')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({ record: data as WaterTestRow });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const gate = await requirePage(cookies, '/admin/water');
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400);

  const { data: existing, error: fetchError } = await db
    .from('water_tests')
    .select('id, recorded_by')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) return json({ error: fetchError.message }, 500);
  if (!existing) return json({ error: 'Entry not found' }, 404);

  // Only the person who logged an entry can remove it — the log is an audit
  // record, so no editing others' entries, admins included.
  const email = (gate.user.email ?? '').toLowerCase();
  if ((existing.recorded_by ?? '').toLowerCase() !== email) {
    return json({ error: 'You can only delete entries you recorded' }, 403);
  }

  const { error } = await db.from('water_tests').delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true });
};
