// Assignment mutations for /admin/schedule: put a person on a shift (times
// default to the shift window), adjust their times/role, or take them off.
// Admin-only, CSRF-guarded in-route. Availability is advisory — the UI warns
// about time-off overlaps but the API doesn't block them (the admin may have
// confirmed with the person, as the sheet's notes show).

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireAdmin } from '@/lib/auth/admin';
import { getDb, type ShiftAssignmentRow } from '@/lib/db';
import { ASSIGNMENT_ROLES, type AssignmentRole } from '@/lib/schedule/constants';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

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

function parseTimesAndRole(body: Record<string, unknown>): Record<string, unknown> | string {
  const fields: Record<string, unknown> = {};
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
  if (body.role !== undefined) {
    if (typeof body.role !== 'string' || !ASSIGNMENT_ROLES.includes(body.role as AssignmentRole)) {
      return `role must be one of: ${ASSIGNMENT_ROLES.join(', ')}`;
    }
    fields.role = body.role;
  }
  if (body.notes !== undefined) {
    if (body.notes !== null && typeof body.notes !== 'string') return 'notes must be a string';
    fields.notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 500) || null : null;
  }
  return fields;
}

export const POST: APIRoute = async ({ cookies, request }) => {
  const denied = await gateMutation(cookies, request);
  if (denied) return denied;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const shiftId = body.shiftId;
  const staffId = body.staffId;
  if (typeof shiftId !== 'string' || !shiftId || typeof staffId !== 'string' || !staffId) {
    return json({ error: 'shiftId and staffId are required' }, 400);
  }

  const fields = parseTimesAndRole(body);
  if (typeof fields === 'string') return json({ error: fields }, 400);

  const { data: shift, error: shiftError } = await db
    .from('shifts')
    .select('id, starts_at, ends_at, status')
    .eq('id', shiftId)
    .maybeSingle();
  if (shiftError) return json({ error: shiftError.message }, 500);
  if (!shift) return json({ error: 'Shift not found' }, 404);
  if (shift.status !== 'active') return json({ error: 'Shift is cancelled' }, 400);

  const startsAt = (fields.starts_at as string) ?? shift.starts_at;
  const endsAt = (fields.ends_at as string) ?? shift.ends_at;
  if (endsAt.slice(0, 5) <= startsAt.slice(0, 5)) {
    return json({ error: 'endsAt must be after startsAt' }, 400);
  }

  const { data, error } = await db
    .from('shift_assignments')
    .insert({
      shift_id: shiftId,
      staff_id: staffId,
      starts_at: startsAt,
      ends_at: endsAt,
      role: (fields.role as AssignmentRole) ?? 'full',
      notes: (fields.notes as string | null) ?? null,
    })
    .select('*')
    .single();
  if (error) {
    // 23505 = unique_violation on (shift_id, staff_id)
    if (error.code === '23505') return json({ error: 'Already assigned to this shift' }, 409);
    return json({ error: error.message }, 500);
  }

  return json({ assignment: data as ShiftAssignmentRow }, 201);
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

  const fields = parseTimesAndRole(body);
  if (typeof fields === 'string') return json({ error: fields }, 400);
  if (Object.keys(fields).length === 0) return json({ error: 'No fields to update' }, 400);

  const { data: existing, error: fetchError } = await db
    .from('shift_assignments')
    .select('id, starts_at, ends_at')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) return json({ error: fetchError.message }, 500);
  if (!existing) return json({ error: 'Assignment not found' }, 404);

  const startsAt = (fields.starts_at as string) ?? existing.starts_at;
  const endsAt = (fields.ends_at as string) ?? existing.ends_at;
  if (endsAt.slice(0, 5) <= startsAt.slice(0, 5)) {
    return json({ error: 'endsAt must be after startsAt' }, 400);
  }

  const { data, error } = await db
    .from('shift_assignments')
    .update(fields)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({ assignment: data as ShiftAssignmentRow });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const denied = await gateMutation(cookies, request);
  if (denied) return denied;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400);

  const { error, count } = await db
    .from('shift_assignments')
    .delete({ count: 'exact' })
    .eq('id', id);
  if (error) return json({ error: error.message }, 500);
  if (!count) return json({ error: 'Assignment not found' }, 404);

  return json({ ok: true });
};
