// Stipend management for /admin/schedule/hours: recurring weekly stipend
// hours (staff_stipends) and their per-week overrides (stipend_overrides).
// Admin-only on every method — a stipend is a pay commitment, so it's gated
// like pay rates, not like schedule managing. CSRF-guarded like users.ts.
//
// Weeks are Monday-keyed: any date arriving in effectiveFrom/effectiveUntil/
// weekStart is snapped to its week's Monday, matching the hours rollup.
// Ending a stipend sets effective_until (history stays priced); DELETE is for
// rows created by mistake and removes their weeks from the report entirely.

import { weekStartOf } from '@pyre/schedule-core';
import type { APIRoute } from 'astro';
import { assertSameOrigin, requireAdmin } from '@/lib/auth/admin';
import { getDb, type StaffStipendRow, type StipendOverrideRow } from '@/lib/db';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Weekly hours in tenth-hour steps; overrides may be 0 (skipped week). */
function parseHours(value: unknown, { allowZero }: { allowZero: boolean }): number | Response {
  const hours = typeof value === 'number' ? value : Number(String(value));
  const min = allowZero ? 0 : 0.1;
  if (!Number.isFinite(hours) || hours < min || hours > 40) {
    return json({ error: `Hours must be between ${allowZero ? 0 : 0.1} and 40` }, 400);
  }
  return Math.round(hours * 10) / 10;
}

/** YYYY-MM-DD snapped to its week's Monday. */
function parseWeek(value: unknown): string | Response {
  const date = String(value ?? '');
  if (!DATE_RE.test(date)) return json({ error: 'Dates must be YYYY-MM-DD' }, 400);
  return weekStartOf(date);
}

function parseLabel(value: unknown): string | Response {
  const label = String(value ?? '').trim();
  if (label.length < 1 || label.length > 80) {
    return json({ error: 'Label must be 1-80 characters' }, 400);
  }
  return label;
}

async function gateMutation(
  cookies: Parameters<APIRoute>[0]['cookies'],
  request: Request
): Promise<Record<string, unknown> | Response> {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
}

export const POST: APIRoute = async ({ cookies, request }) => {
  const body = await gateMutation(cookies, request);
  if (body instanceof Response) return body;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const staffId = String(body.staffId ?? '');
  if (!staffId) return json({ error: 'Missing staffId' }, 400);

  const label = parseLabel(body.label);
  if (label instanceof Response) return label;
  const hours = parseHours(body.hoursPerWeek, { allowZero: false });
  if (hours instanceof Response) return hours;
  const effectiveFrom = parseWeek(body.effectiveFrom);
  if (effectiveFrom instanceof Response) return effectiveFrom;

  let effectiveUntil: string | null = null;
  if (body.effectiveUntil !== undefined && body.effectiveUntil !== null) {
    const parsed = parseWeek(body.effectiveUntil);
    if (parsed instanceof Response) return parsed;
    effectiveUntil = parsed;
  }
  if (effectiveUntil !== null && effectiveUntil < effectiveFrom) {
    return json({ error: 'End week cannot be before the first week' }, 400);
  }

  const { data, error } = await db
    .from('staff_stipends')
    .insert({
      staff_id: staffId,
      label,
      hours_per_week: hours,
      effective_from: effectiveFrom,
      effective_until: effectiveUntil,
    })
    .select('*')
    .single();

  if (error) {
    // 23503 = staffId doesn't reference a staff row.
    if (error.code === '23503') return json({ error: 'No such person' }, 404);
    return json({ error: error.message }, 500);
  }
  return json({ stipend: data as StaffStipendRow }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const body = await gateMutation(cookies, request);
  if (body instanceof Response) return body;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = String(body.id ?? '');
  if (!id) return json({ error: 'Missing id' }, 400);

  const { data: existing, error: readError } = await db
    .from('staff_stipends')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (readError) return json({ error: readError.message }, 500);
  if (!existing) return json({ error: 'No such stipend' }, 404);
  const row = existing as StaffStipendRow;

  const fields: Partial<
    Pick<StaffStipendRow, 'label' | 'hours_per_week' | 'effective_from' | 'effective_until'>
  > = {};

  if (body.label !== undefined) {
    const label = parseLabel(body.label);
    if (label instanceof Response) return label;
    fields.label = label;
  }
  if (body.hoursPerWeek !== undefined) {
    const hours = parseHours(body.hoursPerWeek, { allowZero: false });
    if (hours instanceof Response) return hours;
    fields.hours_per_week = hours;
  }
  if (body.effectiveFrom !== undefined) {
    const from = parseWeek(body.effectiveFrom);
    if (from instanceof Response) return from;
    fields.effective_from = from;
  }
  // Explicit null re-opens an ended stipend.
  if (body.effectiveUntil !== undefined) {
    if (body.effectiveUntil === null) {
      fields.effective_until = null;
    } else {
      const until = parseWeek(body.effectiveUntil);
      if (until instanceof Response) return until;
      fields.effective_until = until;
    }
  }
  if (Object.keys(fields).length === 0) return json({ error: 'Nothing to update' }, 400);

  const from = fields.effective_from ?? row.effective_from;
  const until = fields.effective_until !== undefined ? fields.effective_until : row.effective_until;
  if (until !== null && until < from) {
    return json({ error: 'End week cannot be before the first week' }, 400);
  }

  const { data, error } = await db
    .from('staff_stipends')
    .update(fields)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);
  return json({ stipend: data as StaffStipendRow });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'Missing id' }, 400);

  // Overrides cascade with the stipend.
  const { error } = await db.from('staff_stipends').delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
};

/**
 * Upsert one week's override: {stipendId, weekStart, hours, note?}. hours:
 * null clears the override, putting the week back on the stipend's default.
 */
export const PUT: APIRoute = async ({ cookies, request }) => {
  const body = await gateMutation(cookies, request);
  if (body instanceof Response) return body;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const stipendId = String(body.stipendId ?? '');
  if (!stipendId) return json({ error: 'Missing stipendId' }, 400);
  const weekStart = parseWeek(body.weekStart);
  if (weekStart instanceof Response) return weekStart;

  if (body.hours === null) {
    const { error } = await db
      .from('stipend_overrides')
      .delete()
      .eq('stipend_id', stipendId)
      .eq('week_start', weekStart);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, override: null });
  }

  const hours = parseHours(body.hours, { allowZero: true });
  if (hours instanceof Response) return hours;
  const note =
    body.note === undefined || body.note === null ? null : String(body.note).trim() || null;

  const { data, error } = await db
    .from('stipend_overrides')
    .upsert(
      { stipend_id: stipendId, week_start: weekStart, hours, note },
      { onConflict: 'stipend_id,week_start' }
    )
    .select('*')
    .single();
  if (error) {
    if (error.code === '23503') return json({ error: 'No such stipend' }, 404);
    return json({ error: error.message }, 500);
  }
  return json({ ok: true, override: data as StipendOverrideRow });
};
