// Cold-tub water testing log API for the /admin/water staff tool: GET lists
// entries newest-first (optionally per tub), POST records a new entry with
// readings and the chemicals actually added. Staff-gated (requireStaff), and —
// as the app's first cookie-authed mutating route — CSRF-guarded in-route via
// the JSON content-type requirement plus assertSameOrigin (global checkOrigin
// stays off for the Mailchimp webhook; see astro.config.mjs).

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireStaff } from '@/lib/auth/admin';
import { type DoseRecord, getDb, type WaterTestRow } from '@/lib/db';
import { ENTRY_TYPES, type EntryType, TUBS, type Tub } from '@/lib/water/charts';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

// Sanity bounds only (mirrors the table's check constraints); target-range
// logic lives in src/lib/water/.
const READING_BOUNDS = {
  ta_ppm: [0, 1000],
  ph: [0, 14],
  chlorine_ppm: [0, 50],
  salt_ppm: [0, 20000],
} as const;

type ReadingColumn = keyof typeof READING_BOUNDS;

const READING_KEYS: Record<ReadingColumn, string> = {
  ta_ppm: 'ta',
  ph: 'ph',
  chlorine_ppm: 'chlorine',
  salt_ppm: 'salt',
};

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requireStaff(cookies);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const tub = url.searchParams.get('tub');
  if (tub && !TUBS.includes(tub as Tub)) {
    return json({ error: `tub must be one of: ${TUBS.join(', ')}` }, 400);
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

  const { data, error, count } = await query;
  if (error) return json({ error: error.message }, 500);

  return json({ records: (data ?? []) as WaterTestRow[], total: count ?? 0, limit, offset });
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requireStaff(cookies);
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

  const rawReadings = (body.readings ?? {}) as Record<string, unknown>;
  const readings: Partial<Record<ReadingColumn, number | null>> = {};
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

  if (entryType === 'test' && Object.values(readings).every((v) => v == null)) {
    return json({ error: 'A test entry needs at least one reading' }, 400);
  }

  const rawDoses = body.doses ?? [];
  if (!Array.isArray(rawDoses) || rawDoses.length > 8) {
    return json({ error: 'doses must be an array of at most 8 items' }, 400);
  }
  const doses: DoseRecord[] = [];
  for (const raw of rawDoses) {
    const d = raw as Record<string, unknown>;
    const chemical = typeof d.chemical === 'string' ? d.chemical.trim() : '';
    const grams = d.grams;
    if (!chemical || chemical.length > 64) {
      return json({ error: 'each dose needs a chemical name (max 64 chars)' }, 400);
    }
    if (typeof grams !== 'number' || !Number.isFinite(grams) || grams <= 0 || grams > 500) {
      return json({ error: 'each dose needs grams between 0 and 500' }, 400);
    }
    const dose: DoseRecord = { chemical, grams };
    if (typeof d.reason === 'string' && d.reason) dose.reason = d.reason.slice(0, 200);
    if (typeof d.recommended_grams === 'number' && Number.isFinite(d.recommended_grams)) {
      dose.recommended_grams = d.recommended_grams;
    }
    doses.push(dose);
  }

  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) : '';

  const { data, error } = await db
    .from('water_tests')
    .insert({
      tub,
      entry_type: entryType,
      ...readings,
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
