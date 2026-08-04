// Time-off entries (trip ranges + recurring weekly patterns) for
// /admin/schedule/time-off. Entries auto-approve — there is no status
// workflow; conflicts with existing assignments are surfaced by the UI, not
// blocked here. Admin-only in Phase 1; the Phase-2 employee self-service
// routes will reuse the same table with self-scoping.

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireAdmin, requireStaff } from '@/lib/auth/admin';
import { getDb, type TimeOffRow } from '@/lib/db';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requireStaff(cookies);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  let query = db.from('time_off').select('*').order('created_at', { ascending: false });
  const staffId = url.searchParams.get('staffId');
  if (staffId) query = query.eq('staff_id', staffId);

  const { data, error } = await query;
  if (error) return json({ error: error.message }, 500);

  return json({ entries: (data ?? []) as TimeOffRow[] });
};

/**
 * Validate the full entry shape (both POST and PATCH send it whole — the edit
 * form always submits every field). Returns the row columns, or an error
 * message string.
 */
function parseEntryColumns(body: Record<string, unknown>): Record<string, unknown> | string {
  const staffId = body.staffId;
  if (typeof staffId !== 'string' || !staffId) return 'staffId is required';

  const kind = body.kind;
  if (kind !== 'range' && kind !== 'recurring') return "kind must be 'range' or 'recurring'";

  const startDate = body.startDate ?? null;
  const endDate = body.endDate ?? null;
  for (const [name, value] of [
    ['startDate', startDate],
    ['endDate', endDate],
  ] as const) {
    if (value != null && (typeof value !== 'string' || !DATE_RE.test(value))) {
      return `${name} must be YYYY-MM-DD`;
    }
  }
  if (kind === 'range' && (!startDate || !endDate)) {
    return 'A range entry needs startDate and endDate';
  }
  if (startDate && endDate && (endDate as string) < (startDate as string)) {
    return 'endDate must not be before startDate';
  }

  let daysOfWeek: number[] = [];
  if (kind === 'recurring') {
    const raw = body.daysOfWeek;
    if (
      !Array.isArray(raw) ||
      raw.length === 0 ||
      raw.some((d) => typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 6)
    ) {
      return 'A recurring entry needs daysOfWeek as integers 0 (Sun) – 6 (Sat)';
    }
    daysOfWeek = [...new Set(raw as number[])].sort();
  }

  const startsAt = body.startsAt ?? null;
  const endsAt = body.endsAt ?? null;
  for (const [name, value] of [
    ['startsAt', startsAt],
    ['endsAt', endsAt],
  ] as const) {
    if (value != null && (typeof value !== 'string' || !TIME_RE.test(value))) {
      return `${name} must be HH:MM`;
    }
  }
  if ((startsAt == null) !== (endsAt == null)) {
    return 'startsAt and endsAt must be provided together (or neither)';
  }
  if (startsAt && endsAt && (endsAt as string).slice(0, 5) <= (startsAt as string).slice(0, 5)) {
    return 'endsAt must be after startsAt';
  }

  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';

  return {
    staff_id: staffId,
    kind,
    start_date: startDate,
    end_date: endDate,
    days_of_week: daysOfWeek,
    starts_at: startsAt,
    ends_at: endsAt,
    note: note || null,
  };
}

async function gateAndParse(
  cookies: Parameters<APIRoute>[0]['cookies'],
  request: Request
): Promise<Record<string, unknown> | Response> {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }

  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
}

export const POST: APIRoute = async ({ cookies, request }) => {
  const body = await gateAndParse(cookies, request);
  if (body instanceof Response) return body;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const columns = parseEntryColumns(body);
  if (typeof columns === 'string') return json({ error: columns }, 400);

  const { data, error } = await db
    .from('time_off')
    .insert({ ...columns, created_by: 'admin' })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({ entry: data as TimeOffRow }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const body = await gateAndParse(cookies, request);
  if (body instanceof Response) return body;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = body.id;
  if (typeof id !== 'string' || !id) return json({ error: 'id is required' }, 400);

  const columns = parseEntryColumns(body);
  if (typeof columns === 'string') return json({ error: columns }, 400);

  const { data, error } = await db
    .from('time_off')
    .update(columns)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: 'Entry not found' }, 404);

  return json({ entry: data as TimeOffRow });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400);

  const { error, count } = await db.from('time_off').delete({ count: 'exact' }).eq('id', id);
  if (error) return json({ error: error.message }, 500);
  if (!count) return json({ error: 'Entry not found' }, 404);

  return json({ ok: true });
};
