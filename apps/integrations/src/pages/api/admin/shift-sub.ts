// Sub requests for /admin/schedule. POST: an employee asks for a sub on a
// shift they're assigned to — their hours are logged as time off, every admin
// is emailed, and everyone available that day gets a one-click claim link
// (the requester keeps the shift until someone takes it). PATCH: a logged-in
// teammate takes the shift from the board. DELETE: the requester (or a
// manager) cancels an open request, which also removes the blackout entry.
//
// Creating is gated by the admin 'sub_requests' toggle
// (lib/schedule/settings.ts). Claiming and cancelling are not — an open
// request made before the switch flipped must still be resolvable.

import { availabilityFor, timeToMinutes } from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { APIRoute } from 'astro';
import { hasScheduleManage } from '@/components/admin/adminTools';
import { type AdminGate, assertSameOrigin, requirePage } from '@/lib/auth/admin';
import {
  getDb,
  type ShiftAssignmentRow,
  type StaffRow,
  type SubRequestRow,
  type TimeOffRow,
} from '@/lib/db';
import { sendTemplate } from '@/lib/email/send';
import { actorFromGate, describeShift, logScheduleChange } from '@/lib/schedule/change-log';
import { getScheduleSettings } from '@/lib/schedule/settings';
import {
  claimSubRequest,
  formatDateLabel,
  formatWindowLabel,
  listAdminRecipients,
  todayEastern,
} from '@/lib/schedule/sub';
import { createSubClaimToken } from '@/lib/schedule/sub-token';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** The staff row matching the caller's login email, or null. */
async function selfStaff(db: SupabaseClient, gate: AdminGate): Promise<StaffRow | null> {
  const email = (gate.user.email ?? '').toLowerCase();
  if (!email) return null;

  const { data } = await db.from('staff').select('*');
  const rows = (data ?? []) as StaffRow[];
  return rows.find((s) => (s.email ?? '').toLowerCase() === email) ?? null;
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

/** Claim links outlive the shift date by a couple of days; the claim path
 * re-validates everything anyway, so expiry is just a hygiene backstop. */
function claimLinkExpiryDays(shiftDate: string): number {
  const msUntil = new Date(`${shiftDate}T00:00:00`).getTime() - Date.now();
  const days = Math.ceil(msUntil / (24 * 60 * 60 * 1000)) + 2;
  return Math.min(Math.max(days, 2), 60);
}

// --- POST: request a sub for an assigned shift ----------------------------

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, '/admin/schedule');
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const settings = await getScheduleSettings();
  if (!settings.subRequestsEnabled) {
    return json({ error: 'Sub requests are currently turned off — talk to an admin' }, 403);
  }

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const shiftId = body.shiftId;
  if (typeof shiftId !== 'string' || !shiftId) return json({ error: 'shiftId is required' }, 400);

  const self = await selfStaff(db, gate);
  if (!self) return json({ error: "Your login isn't linked to the schedule roster" }, 403);

  const { data: shift, error: shiftError } = await db
    .from('shifts')
    .select('id, shift_date, label, starts_at, ends_at, status, is_draft')
    .eq('id', shiftId)
    .maybeSingle();
  if (shiftError) return json({ error: shiftError.message }, 500);
  if (!shift || shift.is_draft) return json({ error: 'Shift not found' }, 404);
  if (shift.status !== 'active') return json({ error: 'Shift is cancelled' }, 400);
  if (shift.shift_date < todayEastern()) {
    return json({ error: 'That shift is in the past' }, 400);
  }

  const { data: assignmentRow, error: assignmentError } = await db
    .from('shift_assignments')
    .select('*')
    .eq('shift_id', shiftId)
    .eq('staff_id', self.id)
    .eq('is_draft', false)
    .maybeSingle();
  if (assignmentError) return json({ error: assignmentError.message }, 500);
  if (!assignmentRow) return json({ error: "You're not on this shift" }, 404);
  const assignment = assignmentRow as ShiftAssignmentRow;

  const actor = actorFromGate(gate);
  const shiftDesc = describeShift(shift);

  // 1. Blackout: the requester can't work these hours, whoever ends up on.
  const { data: timeOffRow, error: timeOffError } = await db
    .from('time_off')
    .insert({
      staff_id: self.id,
      kind: 'range',
      start_date: shift.shift_date,
      end_date: shift.shift_date,
      days_of_week: [],
      starts_at: assignment.starts_at,
      ends_at: assignment.ends_at,
      note: `Requested a sub for '${shift.label}'`,
      created_by: 'staff',
    })
    .select('*')
    .single();
  if (timeOffError) return json({ error: timeOffError.message }, 500);
  const timeOff = timeOffRow as TimeOffRow;

  // 2. The open sub request (the unique index rejects a duplicate open one).
  const { data: subRow, error: subError } = await db
    .from('sub_requests')
    .insert({
      shift_id: shiftId,
      requester_staff_id: self.id,
      starts_at: assignment.starts_at,
      ends_at: assignment.ends_at,
      role: assignment.role,
      duties: assignment.duties,
      time_off_id: timeOff.id,
    })
    .select('*')
    .single();
  if (subError) {
    // Roll the blackout back so a retry doesn't stack duplicates.
    await db.from('time_off').delete().eq('id', timeOff.id);
    if (subError.code === '23505') {
      return json({ error: 'You already have an open sub request for this shift' }, 409);
    }
    return json({ error: subError.message }, 500);
  }
  const sub = subRow as SubRequestRow;

  await logScheduleChange(db, {
    actor,
    entityType: 'sub_request',
    entityId: sub.id,
    action: 'create',
    summary: `${self.display_name} requested a sub for ${shiftDesc} (${formatWindowLabel(sub)})`,
    details: { after: sub },
  });
  await logScheduleChange(db, {
    actor,
    entityType: 'time_off',
    entityId: timeOff.id,
    action: 'create',
    summary: `Added time off for ${self.display_name} — sub requested for ${shiftDesc}`,
    details: { after: timeOff },
  });

  // 3. Who could take it: active, reachable, not the requester, not already
  // on the shift, and free (per time off) for the requester's window.
  const [staffRes, timeOffRes, assignedRes] = await Promise.all([
    db.from('staff').select('*'),
    db.from('time_off').select('*'),
    db.from('shift_assignments').select('staff_id').eq('shift_id', shiftId),
  ]);
  const staff = (staffRes.data ?? []) as StaffRow[];
  const allTimeOff = (timeOffRes.data ?? []) as TimeOffRow[];
  const assignedIds = new Set(
    ((assignedRes.data ?? []) as Array<{ staff_id: string }>).map((a) => a.staff_id)
  );
  const startMin = timeToMinutes(assignment.starts_at);
  const endMin = timeToMinutes(assignment.ends_at);
  const available = staff.filter(
    (s) =>
      s.active &&
      s.email &&
      s.id !== self.id &&
      !assignedIds.has(s.id) &&
      availabilityFor(allTimeOff, s.id, shift.shift_date, startMin, endMin).status === 'free'
  );

  // 4. Emails, best-effort per recipient. Claim links are per-recipient
  // signed tokens; without a signing secret we still notify, minus the link
  // recipients (the admins' email says nobody could be auto-asked).
  const origin = new URL(request.url).origin;
  const scheduleUrl = `${origin}/admin/schedule`;
  const shared = {
    shiftLabel: shift.label,
    dateLabel: formatDateLabel(shift.shift_date),
    timeLabel: formatWindowLabel(assignment),
    scheduleUrl,
  };
  const expiryDays = claimLinkExpiryDays(shift.shift_date);

  let availableNotified = 0;
  for (const person of available) {
    const token = createSubClaimToken(sub.id, person.id, expiryDays);
    if (!token) break;
    try {
      const result = await sendTemplate({
        to: person.email as string,
        template: 'sub-open-notice',
        props: {
          ...shared,
          firstName: person.display_name,
          requesterName: self.display_name,
          claimUrl: `${origin}/api/schedule/sub-claim?token=${encodeURIComponent(token)}`,
        },
        kind: 'transactional',
      });
      if (result.status === 'sent') availableNotified += 1;
    } catch (e) {
      console.error(
        `[shift-sub] notify ${person.email} failed:`,
        e instanceof Error ? e.message : e
      );
    }
  }

  let adminsNotified = 0;
  for (const admin of await listAdminRecipients(db)) {
    try {
      const result = await sendTemplate({
        to: admin.email as string,
        template: 'sub-request-notice',
        props: { ...shared, staffName: self.display_name, notifiedCount: availableNotified },
        kind: 'transactional',
      });
      if (result.status === 'sent') adminsNotified += 1;
    } catch (e) {
      console.error(
        `[shift-sub] notify ${admin.email} failed:`,
        e instanceof Error ? e.message : e
      );
    }
  }

  await db.from('sub_requests').update({ notified_count: availableNotified }).eq('id', sub.id);

  return json(
    {
      ok: true,
      subRequest: sub,
      notified: { admins: adminsNotified, available: availableNotified },
    },
    201
  );
};

// --- PATCH: take an open sub from the board (logged-in claim) -------------

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, '/admin/schedule');
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const id = body.id;
  if (typeof id !== 'string' || !id) return json({ error: 'id is required' }, 400);
  if (body.action !== 'claim') return json({ error: "action must be 'claim'" }, 400);

  const self = await selfStaff(db, gate);
  if (!self) return json({ error: "Your login isn't linked to the schedule roster" }, 403);

  const result = await claimSubRequest(
    db,
    id,
    self.id,
    actorFromGate(gate),
    `${new URL(request.url).origin}/admin/schedule`
  );

  switch (result.outcome) {
    case 'claimed':
      return json({ ok: true });
    case 'already-claimed':
      return json({ error: `${result.byName ?? 'Someone'} already took this shift` }, 409);
    case 'cancelled':
      return json({ error: 'This sub request was cancelled' }, 409);
    case 'not-found':
      return json({ error: 'Sub request not found' }, 404);
    case 'shift-gone':
      return json({ error: 'The shift no longer exists or was cancelled' }, 409);
    case 'past':
      return json({ error: 'That shift is in the past' }, 400);
    case 'own-request':
      return json({ error: "You can't take your own sub request" }, 400);
    case 'already-assigned':
      return json({ error: "You're already on this shift" }, 409);
    case 'error':
      return json({ error: result.message }, 500);
  }
};

// --- DELETE: cancel an open sub request -----------------------------------

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const gate = await requirePage(cookies, '/admin/schedule');
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400);

  const { data: existing, error: fetchError } = await db
    .from('sub_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) return json({ error: fetchError.message }, 500);
  if (!existing) return json({ error: 'Sub request not found' }, 404);
  const sub = existing as SubRequestRow;

  if (!hasScheduleManage(gate.access)) {
    const self = await selfStaff(db, gate);
    if (!self || sub.requester_staff_id !== self.id) {
      return json({ error: 'You can only cancel your own sub requests' }, 403);
    }
  }
  if (sub.status !== 'open') {
    return json({ error: `This sub request was already ${sub.status}` }, 409);
  }

  // Same open-only guard as claiming, so a cancel can't race a claim.
  const { data: cancelled, error: cancelError } = await db
    .from('sub_requests')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('status', 'open')
    .select('*')
    .maybeSingle();
  if (cancelError) return json({ error: cancelError.message }, 500);
  if (!cancelled) return json({ error: 'Someone just took this shift' }, 409);

  // The blackout came in with the request, so it leaves with it too.
  if (sub.time_off_id) await db.from('time_off').delete().eq('id', sub.time_off_id);

  const { data: shift } = await db
    .from('shifts')
    .select('label, shift_date')
    .eq('id', sub.shift_id)
    .maybeSingle();
  await logScheduleChange(db, {
    actor: actorFromGate(gate),
    entityType: 'sub_request',
    entityId: sub.id,
    action: 'discard',
    summary: `Cancelled a sub request for ${shift ? describeShift(shift as { label: string; shift_date: string }) : 'a shift'}`,
    details: { before: sub, after: cancelled },
  });

  return json({ ok: true });
};
