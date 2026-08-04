// Shift CRUD for /admin/schedule (reads come from schedule-board). Admin-only
// mutations, CSRF-guarded in-route via assertSameOrigin (global checkOrigin is
// off — see astro.config.mjs). Editing a momence-sourced shift sets
// sync_locked so the Phase-3 sync won't overwrite the admin's adjustment.

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireAdmin } from '@/lib/auth/admin';
import { getDb, type ShiftRow } from '@/lib/db';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

function parseCommonFields(body: Record<string, unknown>): Record<string, unknown> | string {
  const fields: Record<string, unknown> = {};

  if (body.shiftDate !== undefined) {
    if (typeof body.shiftDate !== 'string' || !DATE_RE.test(body.shiftDate)) {
      return 'shiftDate must be YYYY-MM-DD';
    }
    fields.shift_date = body.shiftDate;
  }
  if (body.label !== undefined) {
    if (typeof body.label !== 'string' || !body.label.trim() || body.label.length > 40) {
      return 'label must be 1-40 characters';
    }
    fields.label = body.label.trim();
  }
  for (const [key, column] of [
    ['startsAt', 'starts_at'],
    ['endsAt', 'ends_at'],
  ] as const) {
    const value = body[key];
    if (value !== undefined) {
      if (typeof value !== 'string' || !TIME_RE.test(value)) return `${key} must be HH:MM`;
      fields[column] = value;
    }
  }
  if (body.staffNeeded !== undefined) {
    const n = body.staffNeeded;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 20) {
      return 'staffNeeded must be an integer between 0 and 20';
    }
    fields.staff_needed = n;
  }
  if (body.notes !== undefined) {
    if (body.notes !== null && typeof body.notes !== 'string') return 'notes must be a string';
    fields.notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) || null : null;
  }
  if (body.status !== undefined) {
    if (body.status !== 'active' && body.status !== 'cancelled') {
      return "status must be 'active' or 'cancelled'";
    }
    fields.status = body.status;
  }

  if (
    typeof fields.starts_at === 'string' &&
    typeof fields.ends_at === 'string' &&
    fields.ends_at <= fields.starts_at
  ) {
    return 'endsAt must be after startsAt';
  }

  return fields;
}

async function gateMutation(
  cookies: Parameters<APIRoute>[0]['cookies'],
  request: Request
): Promise<Response | null> {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  return null;
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

export const POST: APIRoute = async ({ cookies, request }) => {
  const denied = await gateMutation(cookies, request);
  if (denied) return denied;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const fields = parseCommonFields(body);
  if (typeof fields === 'string') return json({ error: fields }, 400);
  for (const required of ['shift_date', 'label', 'starts_at', 'ends_at'] as const) {
    if (fields[required] === undefined) {
      return json({ error: 'shiftDate, label, startsAt, and endsAt are required' }, 400);
    }
  }

  const { data, error } = await db
    .from('shifts')
    .insert({ ...fields, source: 'manual' })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({ shift: data as ShiftRow }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const denied = await gateMutation(cookies, request);
  if (denied) return denied;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const id = body.id;
  if (typeof id !== 'string' || !id) return json({ error: 'id is required' }, 400);

  const fields = parseCommonFields(body);
  if (typeof fields === 'string') return json({ error: fields }, 400);
  if (Object.keys(fields).length === 0) return json({ error: 'No fields to update' }, 400);

  const { data: existing, error: fetchError } = await db
    .from('shifts')
    .select('id, source, starts_at, ends_at')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) return json({ error: fetchError.message }, 500);
  if (!existing) return json({ error: 'Shift not found' }, 404);

  // Cross-field time check when only one side changes.
  const starts = (fields.starts_at as string) ?? existing.starts_at;
  const ends = (fields.ends_at as string) ?? existing.ends_at;
  if (ends.slice(0, 5) <= starts.slice(0, 5))
    return json({ error: 'endsAt must be after startsAt' }, 400);

  if (existing.source === 'momence') fields.sync_locked = true;

  const { data, error } = await db.from('shifts').update(fields).eq('id', id).select('*').single();
  if (error) return json({ error: error.message }, 500);

  return json({ shift: data as ShiftRow });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const denied = await gateMutation(cookies, request);
  if (denied) return denied;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400);

  // Hard delete (assignments cascade) — for mistakes. Cancelling a real shift
  // that people were scheduled for should PATCH status instead, so the record
  // survives.
  const { error, count } = await db.from('shifts').delete({ count: 'exact' }).eq('id', id);
  if (error) return json({ error: error.message }, 500);
  if (!count) return json({ error: 'Shift not found' }, 404);

  return json({ ok: true });
};
