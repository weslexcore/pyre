// Time-off entries (trip ranges + recurring weekly patterns) for
// /admin/schedule/time-off. Entries auto-approve — there is no status
// workflow; conflicts with existing assignments are surfaced by the UI, not
// blocked here. Managers (schedule:manage / admins) work on anyone's entries;
// everyone else with the schedule page manages only their own — "own" means
// the staff row whose email matches their login.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { APIRoute } from 'astro';
import { hasScheduleManage } from '@/components/admin/adminTools';
import { type AdminGate, assertSameOrigin, requirePage } from '@/lib/auth/admin';
import { getDb, type StaffRow, type TimeOffRow } from '@/lib/db';
import {
  actorFromGate,
  changedFields,
  describeTimeOff,
  logScheduleChange,
  staffNameOf,
  summarizeDiff,
} from '@/lib/schedule/change-log';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, '/admin/schedule');
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

/**
 * The staff row belonging to the caller's login email, or null when their
 * login isn't linked to the roster. Employees may only touch entries for this
 * row.
 */
async function selfStaffId(db: SupabaseClient, gate: AdminGate): Promise<string | null> {
  const email = (gate.user.email ?? '').toLowerCase();
  if (!email) return null;

  const { data } = await db.from('staff').select('id, email');
  const rows = (data ?? []) as Pick<StaffRow, 'id' | 'email'>[];
  return rows.find((s) => (s.email ?? '').toLowerCase() === email)?.id ?? null;
}

/**
 * Gate for mutations: any schedule-page holder passes, but non-managers get
 * back the single staff id they may act on (ownStaffId; null = their login
 * has no roster row, so they may touch nothing).
 */
async function gateMutation(
  cookies: Parameters<APIRoute>[0]['cookies'],
  request: Request,
  db: SupabaseClient
): Promise<{ gate: AdminGate; canManage: boolean; ownStaffId: string | null } | Response> {
  const gate = await requirePage(cookies, '/admin/schedule');
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const canManage = hasScheduleManage(gate.access);
  return { gate, canManage, ownStaffId: canManage ? null : await selfStaffId(db, gate) };
}

const OWN_ONLY_ERROR = 'You can only manage your own time off';

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
  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const auth = await gateMutation(cookies, request, db);
  if (auth instanceof Response) return auth;

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const columns = parseEntryColumns(body);
  if (typeof columns === 'string') return json({ error: columns }, 400);

  if (!auth.canManage && columns.staff_id !== auth.ownStaffId) {
    return json({ error: OWN_ONLY_ERROR }, 403);
  }

  const { data, error } = await db
    .from('time_off')
    .insert({ ...columns, created_by: auth.canManage ? 'admin' : 'staff' })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  const entry = data as TimeOffRow;
  await logScheduleChange(db, {
    actor: actorFromGate(auth.gate),
    entityType: 'time_off',
    entityId: entry.id,
    action: 'create',
    summary: `Added time off — ${describeTimeOff(await staffNameOf(db, entry.staff_id), entry)}`,
    details: { after: entry },
  });

  return json({ entry }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const auth = await gateMutation(cookies, request, db);
  if (auth instanceof Response) return auth;

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const id = body.id;
  if (typeof id !== 'string' || !id) return json({ error: 'id is required' }, 400);

  const columns = parseEntryColumns(body);
  if (typeof columns === 'string') return json({ error: columns }, 400);

  const { data: existing, error: fetchError } = await db
    .from('time_off')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) return json({ error: fetchError.message }, 500);

  if (!auth.canManage) {
    // Both the existing entry and its new shape must stay their own.
    if (columns.staff_id !== auth.ownStaffId) return json({ error: OWN_ONLY_ERROR }, 403);
    if (existing && existing.staff_id !== auth.ownStaffId) {
      return json({ error: OWN_ONLY_ERROR }, 403);
    }
  }

  const { data, error } = await db
    .from('time_off')
    .update(columns)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: 'Entry not found' }, 404);

  const entry = data as TimeOffRow;
  const diff = existing ? changedFields(existing as Record<string, unknown>, columns) : null;
  if (diff) {
    await logScheduleChange(db, {
      actor: actorFromGate(auth.gate),
      entityType: 'time_off',
      entityId: entry.id,
      action: 'update',
      summary: `Updated time off — ${describeTimeOff(await staffNameOf(db, entry.staff_id), entry)}: ${summarizeDiff(diff)}`,
      details: diff,
    });
  }

  return json({ entry });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const auth = await gateMutation(cookies, request, db);
  if (auth instanceof Response) return auth;

  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400);

  // Snapshot before the delete: ownership check for non-managers, change-log
  // description for everyone.
  const { data: existing, error: fetchError } = await db
    .from('time_off')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) return json({ error: fetchError.message }, 500);
  if (!existing) return json({ error: 'Entry not found' }, 404);
  if (!auth.canManage && existing.staff_id !== auth.ownStaffId) {
    return json({ error: OWN_ONLY_ERROR }, 403);
  }

  const { error, count } = await db.from('time_off').delete({ count: 'exact' }).eq('id', id);
  if (error) return json({ error: error.message }, 500);
  if (!count) return json({ error: 'Entry not found' }, 404);

  const entry = existing as TimeOffRow;
  await logScheduleChange(db, {
    actor: actorFromGate(auth.gate),
    entityType: 'time_off',
    entityId: entry.id,
    action: 'delete',
    summary: `Deleted time off — ${describeTimeOff(await staffNameOf(db, entry.staff_id), entry)}`,
    details: { before: entry },
  });

  return json({ ok: true });
};
