// Shift requests for /admin/schedule: an employee asks to work a shift
// (POST), withdraws a pending ask (DELETE), and a schedule manager approves
// or denies it (PATCH). Approval creates the shift_assignments row with the
// shift's own window; the request row stays as the paper trail.
//
// Requesting is gated by the admin 'shift_requests' toggle
// (lib/schedule/settings.ts). Deciding is not — a pending request placed
// before the feature was switched off must still be closable.

import { utcToEastern } from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { APIRoute } from 'astro';
import { hasScheduleManage } from '@/components/admin/adminTools';
import { type AdminGate, assertSameOrigin, requirePage } from '@/lib/auth/admin';
import { getDb, type ShiftAssignmentRow, type ShiftRequestRow, type StaffRow } from '@/lib/db';
import {
  actorFromGate,
  describeShift,
  logScheduleChange,
  staffNameOf,
} from '@/lib/schedule/change-log';
import { getScheduleSettings } from '@/lib/schedule/settings';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * The staff row belonging to the caller's login email, or null when their
 * login isn't linked to the roster (same contract as schedule-time-off).
 */
async function selfStaffId(db: SupabaseClient, gate: AdminGate): Promise<string | null> {
  const email = (gate.user.email ?? '').toLowerCase();
  if (!email) return null;

  const { data } = await db.from('staff').select('id, email');
  const rows = (data ?? []) as Pick<StaffRow, 'id' | 'email'>[];
  return rows.find((s) => (s.email ?? '').toLowerCase() === email)?.id ?? null;
}

async function gateMutation(
  cookies: Parameters<APIRoute>[0]['cookies'],
  request: Request
): Promise<{ gate: AdminGate; canManage: boolean } | Response> {
  const gate = await requirePage(cookies, '/admin/schedule');
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  return { gate, canManage: hasScheduleManage(gate.access) };
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

/** Today's date in the schedule's wall-clock timezone (America/New_York). */
const todayEastern = (): string => utcToEastern(new Date().toISOString()).date;

// --- POST: an employee asks to work a shift -------------------------------

export const POST: APIRoute = async ({ cookies, request }) => {
  const auth = await gateMutation(cookies, request);
  if (auth instanceof Response) return auth;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const settings = await getScheduleSettings();
  if (!settings.shiftRequestsEnabled) {
    return json({ error: 'Shift requests are currently turned off' }, 403);
  }

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const shiftId = body.shiftId;
  if (typeof shiftId !== 'string' || !shiftId) return json({ error: 'shiftId is required' }, 400);
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';

  const staffId = await selfStaffId(db, auth.gate);
  if (!staffId) {
    return json({ error: "Your login isn't linked to the schedule roster" }, 403);
  }

  const { data: shift, error: shiftError } = await db
    .from('shifts')
    .select('id, shift_date, label, status, is_draft')
    .eq('id', shiftId)
    .maybeSingle();
  if (shiftError) return json({ error: shiftError.message }, 500);
  if (!shift || shift.is_draft) return json({ error: 'Shift not found' }, 404);
  if (shift.status !== 'active') return json({ error: 'Shift is cancelled' }, 400);
  if (shift.shift_date < todayEastern()) {
    return json({ error: 'That shift is in the past' }, 400);
  }

  const { data: existing, error: assignedError } = await db
    .from('shift_assignments')
    .select('id')
    .eq('shift_id', shiftId)
    .eq('staff_id', staffId)
    .maybeSingle();
  if (assignedError) return json({ error: assignedError.message }, 500);
  if (existing) return json({ error: "You're already on this shift" }, 409);

  const { data, error } = await db
    .from('shift_requests')
    .insert({ shift_id: shiftId, staff_id: staffId, note: note || null })
    .select('*')
    .single();
  if (error) {
    // 23505 = the partial unique index on pending (shift_id, staff_id)
    if (error.code === '23505') return json({ error: 'Already requested — pending review' }, 409);
    return json({ error: error.message }, 500);
  }

  const request_ = data as ShiftRequestRow;
  await logScheduleChange(db, {
    actor: actorFromGate(auth.gate),
    entityType: 'request',
    entityId: request_.id,
    action: 'create',
    summary: `${await staffNameOf(db, staffId)} requested ${describeShift(shift)}`,
    details: { after: request_ },
  });

  return json({ request: request_ }, 201);
};

// --- PATCH: a schedule manager approves or denies -------------------------

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const auth = await gateMutation(cookies, request);
  if (auth instanceof Response) return auth;
  if (!auth.canManage) return json({ error: 'Forbidden' }, 403);

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const id = body.id;
  if (typeof id !== 'string' || !id) return json({ error: 'id is required' }, 400);
  const action = body.action;
  if (action !== 'approve' && action !== 'deny') {
    return json({ error: "action must be 'approve' or 'deny'" }, 400);
  }

  const { data: existing, error: fetchError } = await db
    .from('shift_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) return json({ error: fetchError.message }, 500);
  if (!existing) return json({ error: 'Request not found' }, 404);
  const pending = existing as ShiftRequestRow;
  if (pending.status !== 'pending') {
    return json({ error: `Request was already ${pending.status}` }, 409);
  }

  const actor = actorFromGate(auth.gate);
  const requesterName = await staffNameOf(db, pending.staff_id);

  let assignment: ShiftAssignmentRow | null = null;
  if (action === 'approve') {
    const { data: shift, error: shiftError } = await db
      .from('shifts')
      .select('id, shift_date, label, starts_at, ends_at, status')
      .eq('id', pending.shift_id)
      .maybeSingle();
    if (shiftError) return json({ error: shiftError.message }, 500);
    if (!shift) return json({ error: 'Shift no longer exists' }, 404);
    if (shift.status !== 'active') return json({ error: 'Shift is cancelled' }, 400);

    const { data, error } = await db
      .from('shift_assignments')
      .insert({
        shift_id: pending.shift_id,
        staff_id: pending.staff_id,
        starts_at: shift.starts_at,
        ends_at: shift.ends_at,
        role: 'full',
        notes: null,
      })
      .select('*')
      .single();
    // 23505 = already assigned by hand in the meantime — the approval's goal
    // is already met, so just close out the request.
    if (error && error.code !== '23505') return json({ error: error.message }, 500);
    assignment = (data as ShiftAssignmentRow | null) ?? null;

    if (assignment) {
      await logScheduleChange(db, {
        actor,
        entityType: 'assignment',
        entityId: assignment.id,
        action: 'create',
        summary: `Assigned ${requesterName} to ${describeShift(shift)} (approved request)`,
        details: { after: assignment },
      });
    }
  }

  const decidedEmail = (auth.gate.user.email ?? '').toLowerCase() || null;
  const { data: updated, error: updateError } = await db
    .from('shift_requests')
    .update({
      status: action === 'approve' ? 'approved' : 'denied',
      decided_by: decidedEmail,
      decided_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();
  if (updateError) return json({ error: updateError.message }, 500);

  const decided = updated as ShiftRequestRow;
  await logScheduleChange(db, {
    actor,
    entityType: 'request',
    entityId: decided.id,
    action: action === 'approve' ? 'approve' : 'deny',
    summary: `${action === 'approve' ? 'Approved' : 'Denied'} ${requesterName}'s shift request`,
    details: { before: pending, after: decided },
  });

  return json({ request: decided, assignment });
};

// --- DELETE: withdraw a pending request -----------------------------------

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const auth = await gateMutation(cookies, request);
  if (auth instanceof Response) return auth;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400);

  const { data: existing, error: fetchError } = await db
    .from('shift_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) return json({ error: fetchError.message }, 500);
  if (!existing) return json({ error: 'Request not found' }, 404);

  const row = existing as ShiftRequestRow;
  if (!auth.canManage) {
    const staffId = await selfStaffId(db, auth.gate);
    if (!staffId || row.staff_id !== staffId) {
      return json({ error: 'You can only withdraw your own requests' }, 403);
    }
  }
  if (row.status !== 'pending') {
    return json({ error: 'Only pending requests can be withdrawn' }, 409);
  }

  const { error, count } = await db.from('shift_requests').delete({ count: 'exact' }).eq('id', id);
  if (error) return json({ error: error.message }, 500);
  if (!count) return json({ error: 'Request not found' }, 404);

  await logScheduleChange(db, {
    actor: actorFromGate(auth.gate),
    entityType: 'request',
    entityId: row.id,
    action: 'delete',
    summary: `Withdrew ${await staffNameOf(db, row.staff_id)}'s shift request`,
    details: { before: row },
  });

  return json({ ok: true });
};
