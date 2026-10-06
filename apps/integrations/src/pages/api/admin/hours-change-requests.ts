// Hours change requests for /admin/schedule: someone on a shift asks to move
// their own arrive/leave times (POST) — staying late, coming in early, before
// or after the fact — withdraws a pending ask (DELETE), and a schedule
// manager approves or denies it (PATCH). The assignment keeps its hours until
// approval writes the requested ones onto it; the request row stays as the
// paper trail.
//
// Asking is gated by the admin 'hours_changes' toggle
// (lib/schedule/settings.ts). Deciding is not — a pending ask made before the
// feature was switched off must still be closable.

import { addDays, HOURS_CHANGE_LOOKBACK_DAYS, todayEastern } from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { APIRoute } from 'astro';
import { hasScheduleManage } from '@/components/admin/adminTools';
import type { AdminGate } from '@/lib/auth/admin';
import {
  getDb,
  type HoursChangeRequestRow,
  type ShiftAssignmentRow,
  type StaffRow,
} from '@/lib/db';
import { sendTemplate } from '@/lib/email/send';
import { dbError, gateMutation, json, readJsonBody } from '@/lib/http/route';
import { deleteBySource } from '@/lib/notifications/notify';
import { notifyHoursChange } from '@/lib/notifications/schedule';
import {
  actorFromGate,
  describeShift,
  logScheduleChange,
  staffNameOf,
} from '@/lib/schedule/change-log';
import { getScheduleSettings } from '@/lib/schedule/settings';
import { formatDateLabel, formatWindowLabel } from '@/lib/schedule/sub';
import { TIME_RE } from '@/lib/schedule/validate';

export const prerender = false;

const SHIFT_COLUMNS = 'id, shift_date, label, starts_at, ends_at, status, is_draft';

interface ShiftLite {
  id: string;
  shift_date: string;
  label: string;
  starts_at: string;
  ends_at: string;
  status: string;
  is_draft: boolean;
}

/**
 * The staff row belonging to the caller's login email, or null when their
 * login isn't linked to the roster (same contract as shift-requests).
 */
async function selfStaffId(db: SupabaseClient, gate: AdminGate): Promise<string | null> {
  const email = (gate.user.email ?? '').toLowerCase();
  if (!email) return null;

  const { data } = await db.from('staff').select('id, email');
  const rows = (data ?? []) as Pick<StaffRow, 'id' | 'email'>[];
  return rows.find((s) => (s.email ?? '').toLowerCase() === email)?.id ?? null;
}

async function gateSchedule(
  cookies: Parameters<APIRoute>[0]['cookies'],
  request: Request
): Promise<{ gate: AdminGate; canManage: boolean } | Response> {
  const gate = await gateMutation(cookies, request, '/admin/schedule');
  if (gate instanceof Response) return gate;

  return { gate, canManage: hasScheduleManage(gate.access) };
}

/** "09:00–17:30" for the change log. */
const hhmm = (startsAt: string, endsAt: string): string =>
  `${startsAt.slice(0, 5)}–${endsAt.slice(0, 5)}`;

const fromWindow = (r: HoursChangeRequestRow) => ({
  starts_at: r.from_starts_at,
  ends_at: r.from_ends_at,
});
const toWindow = (r: HoursChangeRequestRow) => ({
  starts_at: r.requested_starts_at,
  ends_at: r.requested_ends_at,
});

// --- POST: someone on a shift asks for new hours ---------------------------

export const POST: APIRoute = async ({ cookies, request }) => {
  const auth = await gateSchedule(cookies, request);
  if (auth instanceof Response) return auth;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const settings = await getScheduleSettings();
  if (!settings.hoursChangesEnabled) {
    return json({ error: 'Hours changes are currently turned off' }, 403);
  }

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const assignmentId = body.assignmentId;
  if (typeof assignmentId !== 'string' || !assignmentId) {
    return json({ error: 'assignmentId is required' }, 400);
  }
  const startsAt = body.startsAt;
  const endsAt = body.endsAt;
  if (
    typeof startsAt !== 'string' ||
    !TIME_RE.test(startsAt) ||
    typeof endsAt !== 'string' ||
    !TIME_RE.test(endsAt)
  ) {
    return json({ error: 'startsAt and endsAt must be HH:MM' }, 400);
  }
  if (endsAt.slice(0, 5) <= startsAt.slice(0, 5)) {
    return json({ error: 'endsAt must be after startsAt' }, 400);
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';

  const staffId = await selfStaffId(db, auth.gate);
  if (!staffId) {
    return json({ error: "Your login isn't linked to the schedule roster" }, 403);
  }

  const { data: assignmentRow, error: assignmentError } = await db
    .from('shift_assignments')
    .select('*')
    .eq('id', assignmentId)
    .maybeSingle();
  if (assignmentError) return dbError(assignmentError);
  const assignment = assignmentRow as ShiftAssignmentRow | null;
  if (!assignment || assignment.is_draft) return json({ error: 'Assignment not found' }, 404);
  if (assignment.staff_id !== staffId) {
    return json({ error: 'You can only change your own hours' }, 403);
  }
  if (
    startsAt.slice(0, 5) === assignment.starts_at.slice(0, 5) &&
    endsAt.slice(0, 5) === assignment.ends_at.slice(0, 5)
  ) {
    return json({ error: 'Those are already your hours' }, 400);
  }

  const { data: shiftRow, error: shiftError } = await db
    .from('shifts')
    .select(SHIFT_COLUMNS)
    .eq('id', assignment.shift_id)
    .maybeSingle();
  if (shiftError) return dbError(shiftError);
  const shift = shiftRow as ShiftLite | null;
  if (!shift || shift.is_draft) return json({ error: 'Shift not found' }, 404);
  if (shift.status !== 'active') return json({ error: 'Shift is cancelled' }, 400);
  // Past shifts are fine (staying late is often asked about afterwards), but
  // only as far back as the board's Requests view reaches.
  if (shift.shift_date < addDays(todayEastern(), -HOURS_CHANGE_LOOKBACK_DAYS)) {
    return json({ error: 'That shift is too far back to change' }, 400);
  }

  const { data, error } = await db
    .from('hours_change_requests')
    .insert({
      assignment_id: assignment.id,
      shift_id: shift.id,
      staff_id: staffId,
      from_starts_at: assignment.starts_at,
      from_ends_at: assignment.ends_at,
      requested_starts_at: startsAt,
      requested_ends_at: endsAt,
      note: note || null,
    })
    .select('*')
    .single();
  // 23505 = the partial unique index on a pending ask per assignment
  if (error) return dbError(error, 'You already asked to change these hours — pending review');

  const created = data as HoursChangeRequestRow;
  const actor = actorFromGate(auth.gate);
  await logScheduleChange(db, {
    actor,
    entityType: 'request',
    entityId: created.id,
    action: 'create',
    summary: `${await staffNameOf(db, staffId)} asked to change their hours on ${describeShift(shift)} (${hhmm(
      created.from_starts_at,
      created.from_ends_at
    )} → ${hhmm(created.requested_starts_at, created.requested_ends_at)})`,
    details: { after: created },
  });
  await notifyHoursChange(db, {
    event: 'requested',
    requestId: created.id,
    shift,
    from: fromWindow(created),
    to: toWindow(created),
    requesterStaffId: staffId,
    note: created.note,
    actorEmail: actor.email,
  });

  return json({ request: created }, 201);
};

// --- PATCH: a schedule manager approves or denies --------------------------

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const auth = await gateSchedule(cookies, request);
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
  // Optional reason from the manager — stored on the request and included in
  // the decision email to the requester.
  const decisionNote = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';

  const { data: existing, error: fetchError } = await db
    .from('hours_change_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) return dbError(fetchError);
  if (!existing) return json({ error: 'Request not found' }, 404);
  const pending = existing as HoursChangeRequestRow;
  if (pending.status !== 'pending') {
    return json({ error: `Request was already ${pending.status}` }, 409);
  }

  const { data: shiftRow, error: shiftError } = await db
    .from('shifts')
    .select(SHIFT_COLUMNS)
    .eq('id', pending.shift_id)
    .maybeSingle();
  if (shiftError) return dbError(shiftError);
  const shift = shiftRow as ShiftLite | null;

  const actor = actorFromGate(auth.gate);
  const requesterName = await staffNameOf(db, pending.staff_id);

  let assignment: ShiftAssignmentRow | null = null;
  if (action === 'approve') {
    if (!shift) return json({ error: 'Shift no longer exists' }, 404);
    if (shift.status !== 'active') return json({ error: 'Shift is cancelled' }, 400);

    const { data: before, error: beforeError } = await db
      .from('shift_assignments')
      .select('*')
      .eq('id', pending.assignment_id)
      .maybeSingle();
    if (beforeError) return dbError(beforeError);
    if (!before) return json({ error: 'They are no longer on this shift' }, 404);

    const { data, error } = await db
      .from('shift_assignments')
      .update({ starts_at: pending.requested_starts_at, ends_at: pending.requested_ends_at })
      .eq('id', pending.assignment_id)
      .select('*')
      .single();
    if (error) return dbError(error);
    assignment = data as ShiftAssignmentRow;

    const prior = before as ShiftAssignmentRow;
    await logScheduleChange(db, {
      actor,
      entityType: 'assignment',
      entityId: assignment.id,
      action: 'update',
      summary: `Changed ${requesterName}'s hours on ${describeShift(shift)}: ${hhmm(
        prior.starts_at,
        prior.ends_at
      )} → ${hhmm(assignment.starts_at, assignment.ends_at)} (approved request)`,
      details: {
        starts_at: { from: prior.starts_at, to: assignment.starts_at },
        ends_at: { from: prior.ends_at, to: assignment.ends_at },
      },
    });
  }

  const decidedEmail = (auth.gate.user.email ?? '').toLowerCase() || null;
  const { data: updated, error: updateError } = await db
    .from('hours_change_requests')
    .update({
      status: action === 'approve' ? 'approved' : 'denied',
      decided_by: decidedEmail,
      decided_at: new Date().toISOString(),
      decision_note: decisionNote || null,
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();
  if (updateError) return dbError(updateError);
  if (!updated) return json({ error: 'Request was already decided' }, 409);

  const decided = updated as HoursChangeRequestRow;
  await logScheduleChange(db, {
    actor,
    entityType: 'request',
    entityId: decided.id,
    action: action === 'approve' ? 'approve' : 'deny',
    summary: `${action === 'approve' ? 'Approved' : 'Denied'} ${requesterName}'s hours change${
      decisionNote ? ` — ${decisionNote}` : ''
    }`,
    details: { before: pending, after: decided },
  });

  if (shift) {
    await notifyHoursChange(db, {
      event: action === 'approve' ? 'approved' : 'denied',
      requestId: decided.id,
      shift,
      from: fromWindow(decided),
      to: toWindow(decided),
      requesterStaffId: decided.staff_id,
      note: decisionNote || null,
      actorEmail: actor.email,
    });

    // Close the loop by email too — best-effort: the decision stands whether
    // or not it goes out.
    const { data: requester } = await db
      .from('staff')
      .select('email')
      .eq('id', decided.staff_id)
      .maybeSingle();
    const requesterEmail = (requester?.email as string | null) ?? null;
    if (requesterEmail) {
      try {
        await sendTemplate({
          to: requesterEmail,
          template: 'hours-change-decision',
          props: {
            firstName: requesterName.split(' ')[0] || requesterName,
            decision: action === 'approve' ? 'approved' : 'denied',
            shiftLabel: shift.label,
            dateLabel: formatDateLabel(shift.shift_date),
            fromTimeLabel: formatWindowLabel(fromWindow(decided)),
            timeLabel: formatWindowLabel(toWindow(decided)),
            reasonNote: decisionNote || null,
            scheduleUrl: `${new URL(request.url).origin}/admin/schedule`,
          },
          kind: 'transactional',
        });
      } catch (e) {
        console.error(
          `[hours-change-requests] decision notify ${requesterEmail} failed:`,
          e instanceof Error ? e.message : e
        );
      }
    }
  }

  return json({ request: decided, assignment });
};

// --- DELETE: withdraw a pending ask ----------------------------------------

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const auth = await gateSchedule(cookies, request);
  if (auth instanceof Response) return auth;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400);

  const { data: existing, error: fetchError } = await db
    .from('hours_change_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) return dbError(fetchError);
  if (!existing) return json({ error: 'Request not found' }, 404);

  const row = existing as HoursChangeRequestRow;
  if (!auth.canManage) {
    const staffId = await selfStaffId(db, auth.gate);
    if (!staffId || row.staff_id !== staffId) {
      return json({ error: 'You can only withdraw your own requests' }, 403);
    }
  }
  if (row.status !== 'pending') {
    return json({ error: 'Only pending requests can be withdrawn' }, 409);
  }

  const { error, count } = await db
    .from('hours_change_requests')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('status', 'pending');
  if (error) return dbError(error);
  if (!count) return json({ error: 'Request not found' }, 404);

  await deleteBySource(db, 'hours_change', row.id);
  await logScheduleChange(db, {
    actor: actorFromGate(auth.gate),
    entityType: 'request',
    entityId: row.id,
    action: 'delete',
    summary: `Withdrew ${await staffNameOf(db, row.staff_id)}'s hours change request`,
    details: { before: row },
  });

  return json({ ok: true });
};
