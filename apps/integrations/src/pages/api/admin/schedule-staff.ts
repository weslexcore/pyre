// Roster management for /admin/schedule/staff: add people, set the Momence
// email that links a login to their schedule, toggle founder/active. Rows are
// never hard-deleted — assignments reference them — so departures flip
// active off instead.

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireScheduleManage } from '@/lib/auth/admin';
import { getDb, type ScheduleStaffRow } from '@/lib/db';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseFields(body: Record<string, unknown>): Record<string, unknown> | string {
  const fields: Record<string, unknown> = {};

  if (body.displayName !== undefined) {
    if (
      typeof body.displayName !== 'string' ||
      !body.displayName.trim() ||
      body.displayName.length > 60
    ) {
      return 'displayName must be 1-60 characters';
    }
    fields.display_name = body.displayName.trim();
  }
  if (body.momenceEmail !== undefined) {
    if (body.momenceEmail === null || body.momenceEmail === '') {
      fields.momence_email = null;
    } else if (typeof body.momenceEmail !== 'string' || !EMAIL_RE.test(body.momenceEmail.trim())) {
      return 'momenceEmail must be a valid email';
    } else {
      fields.momence_email = body.momenceEmail.trim().toLowerCase();
    }
  }
  if (body.role !== undefined) {
    if (body.role !== 'admin' && body.role !== 'staff') return "role must be 'admin' or 'staff'";
    fields.role = body.role;
  }
  if (body.isFounder !== undefined) {
    if (typeof body.isFounder !== 'boolean') return 'isFounder must be a boolean';
    fields.is_founder = body.isFounder;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return 'active must be a boolean';
    fields.active = body.active;
  }

  return fields;
}

async function gateMutation(
  cookies: Parameters<APIRoute>[0]['cookies'],
  request: Request
): Promise<Response | null> {
  const gate = await requireScheduleManage(cookies);
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  return null;
}

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requireScheduleManage(cookies);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const { data, error } = await db.from('schedule_staff').select('*').order('display_name');
  if (error) return json({ error: error.message }, 500);

  return json({ staff: (data ?? []) as ScheduleStaffRow[] });
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const denied = await gateMutation(cookies, request);
  if (denied) return denied;

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

  const fields = parseFields(body);
  if (typeof fields === 'string') return json({ error: fields }, 400);
  if (fields.display_name === undefined) return json({ error: 'displayName is required' }, 400);

  const { data, error } = await db.from('schedule_staff').insert(fields).select('*').single();
  if (error) {
    if (error.code === '23505') return json({ error: 'That Momence email is already in use' }, 409);
    return json({ error: error.message }, 500);
  }

  return json({ staff: data as ScheduleStaffRow }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const denied = await gateMutation(cookies, request);
  if (denied) return denied;

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

  const id = body.id;
  if (typeof id !== 'string' || !id) return json({ error: 'id is required' }, 400);

  const fields = parseFields(body);
  if (typeof fields === 'string') return json({ error: fields }, 400);
  if (Object.keys(fields).length === 0) return json({ error: 'No fields to update' }, 400);

  const { data, error } = await db
    .from('schedule_staff')
    .update(fields)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) {
    if (error.code === '23505') return json({ error: 'That Momence email is already in use' }, 409);
    return json({ error: error.message }, 500);
  }
  if (!data) return json({ error: 'Staff member not found' }, 404);

  return json({ staff: data as ScheduleStaffRow });
};
