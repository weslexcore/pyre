// Swap offers on open sub requests, for /admin/schedule. POST: a teammate
// offers one of their own upcoming shifts in exchange for the requested one —
// the requester is told in the dashboard and by email. PATCH: the requester
// accepts (both assignments are exchanged, the sub closes as claimed by the
// offerer) or declines (the sub stays open); the offerer may withdraw; a
// manager may decline on the requester's behalf.
//
// Offering is gated by the same admin 'sub_requests' toggle as asking
// (lib/schedule/settings.ts). Deciding is not — an offer made before the
// switch flipped must still be answerable.

import { todayEastern } from '@pyre/schedule-core';
import type { APIRoute } from 'astro';
import { hasScheduleManage } from '@/components/admin/adminTools';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import {
  getDb,
  type ShiftAssignmentRow,
  type ShiftRow,
  type StaffRow,
  type SubRequestRow,
  type SubSwapOfferRow,
} from '@/lib/db';
import { sendTemplate } from '@/lib/email/send';
import { dbError, json, readJsonBody } from '@/lib/http/route';
import { notifySubEvent } from '@/lib/notifications/schedule';
import { actorFromGate, describeShift, logScheduleChange } from '@/lib/schedule/change-log';
import { selfStaff } from '@/lib/schedule/self-staff';
import { getScheduleSettings } from '@/lib/schedule/settings';
import { formatDateLabel, formatWindowLabel } from '@/lib/schedule/sub';
import { acceptSwapOffer, loadSwapCandidates } from '@/lib/schedule/swap';

export const prerender = false;

type ShiftForNotice = Pick<ShiftRow, 'id' | 'label' | 'shift_date' | 'starts_at' | 'ends_at'>;

// --- POST: offer one of your shifts against an open sub request ------------

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

  const subId = body.subId;
  const shiftId = body.shiftId;
  if (typeof subId !== 'string' || !subId) return json({ error: 'subId is required' }, 400);
  if (typeof shiftId !== 'string' || !shiftId) return json({ error: 'shiftId is required' }, 400);
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';

  const self = await selfStaff(db, gate);
  if (!self) return json({ error: "Your login isn't linked to the schedule roster" }, 403);

  const { data: subRow, error: subError } = await db
    .from('sub_requests')
    .select('*')
    .eq('id', subId)
    .maybeSingle();
  if (subError) return dbError(subError);
  if (!subRow) return json({ error: 'Sub request not found' }, 404);
  const sub = subRow as SubRequestRow;
  if (sub.status !== 'open') return json({ error: `This sub request was ${sub.status}` }, 409);
  if (sub.requester_staff_id === self.id) {
    return json({ error: "You can't offer a swap on your own sub request" }, 400);
  }

  const { data: shiftRows, error: shiftError } = await db
    .from('shifts')
    .select('*')
    .in('id', [sub.shift_id, shiftId]);
  if (shiftError) return dbError(shiftError);
  const shifts = (shiftRows ?? []) as ShiftRow[];
  const shift = shifts.find((s) => s.id === sub.shift_id);
  const offeredShift = shifts.find((s) => s.id === shiftId);
  if (!shift || shift.status !== 'active' || shift.is_draft) {
    return json({ error: 'The requested shift no longer exists or was cancelled' }, 409);
  }
  if (shift.shift_date < todayEastern()) return json({ error: 'That shift is in the past' }, 400);
  if (!offeredShift) return json({ error: 'Shift not found' }, 404);

  // The same rule the board used to show the button, re-run here so a stale
  // board (or a hand-made request) can't offer something that doesn't fit.
  let candidates: Awaited<ReturnType<typeof loadSwapCandidates>>;
  try {
    candidates = await loadSwapCandidates(db, { subs: [sub], offererId: self.id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
  if (!(candidates[sub.id] ?? []).some((c) => c.shiftId === shiftId)) {
    return json({ error: "That shift can't be offered for this swap" }, 400);
  }

  const { data: assignmentRow, error: assignmentError } = await db
    .from('shift_assignments')
    .select('*')
    .eq('shift_id', shiftId)
    .eq('staff_id', self.id)
    .eq('is_draft', false)
    .maybeSingle();
  if (assignmentError) return dbError(assignmentError);
  if (!assignmentRow) return json({ error: "You're not on that shift" }, 404);
  const assignment = assignmentRow as ShiftAssignmentRow;

  const { data: offerRow, error: offerError } = await db
    .from('sub_swap_offers')
    .insert({
      sub_request_id: sub.id,
      offerer_staff_id: self.id,
      offered_shift_id: shiftId,
      starts_at: assignment.starts_at,
      ends_at: assignment.ends_at,
      duties: assignment.duties,
      note: note || null,
    })
    .select('*')
    .single();
  if (offerError) {
    return dbError(offerError, 'You already have a pending swap offer on this request');
  }
  const offer = offerRow as SubSwapOfferRow;

  const actor = actorFromGate(gate);
  const { data: requesterRow } = await db
    .from('staff')
    .select('id, display_name, email')
    .eq('id', sub.requester_staff_id)
    .maybeSingle();
  const requester = requesterRow as Pick<StaffRow, 'id' | 'display_name' | 'email'> | null;
  const requesterName = requester?.display_name ?? 'Unknown staff';

  await logScheduleChange(db, {
    actor,
    entityType: 'swap_offer',
    entityId: offer.id,
    action: 'create',
    summary: `${self.display_name} offered ${requesterName} a swap: ${describeShift(offeredShift)} (${formatWindowLabel(assignment)}) for ${describeShift(shift)} (${formatWindowLabel(sub)})${note ? `: ${note}` : ''}`,
    details: { after: offer },
  });

  await notifySubEvent(db, {
    event: 'swap_offered',
    subId: sub.id,
    shift,
    window: sub,
    requesterStaffId: sub.requester_staff_id,
    claimerStaffId: self.id,
    offeredShift,
    offeredWindow: assignment,
    actorEmail: actor.email,
  });

  // The requester has to act, so they get an email too — best-effort.
  let emailed = false;
  if (requester?.email) {
    try {
      const result = await sendTemplate({
        to: requester.email,
        template: 'sub-swap-offer-notice',
        props: {
          firstName: requesterName,
          offererName: self.display_name,
          shiftLabel: shift.label,
          dateLabel: formatDateLabel(shift.shift_date),
          timeLabel: formatWindowLabel(sub),
          offeredShiftLabel: offeredShift.label,
          offeredDateLabel: formatDateLabel(offeredShift.shift_date),
          offeredTimeLabel: formatWindowLabel(assignment),
          note: note || null,
          scheduleUrl: `${new URL(request.url).origin}/admin/schedule`,
        },
        kind: 'transactional',
      });
      emailed = result.status === 'sent';
    } catch (e) {
      console.error(
        `[shift-swap] notify ${requester.email} failed:`,
        e instanceof Error ? e.message : e
      );
    }
  }

  return json({ ok: true, offer, notified: { requester: emailed } }, 201);
};

// --- PATCH: accept / decline (requester), withdraw (offerer) ---------------

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
  const action = body.action;
  if (typeof id !== 'string' || !id) return json({ error: 'id is required' }, 400);
  if (action !== 'accept' && action !== 'decline' && action !== 'withdraw') {
    return json({ error: "action must be 'accept', 'decline' or 'withdraw'" }, 400);
  }

  const self = await selfStaff(db, gate);
  if (!self) return json({ error: "Your login isn't linked to the schedule roster" }, 403);
  const actor = actorFromGate(gate);
  const scheduleUrl = `${new URL(request.url).origin}/admin/schedule`;

  if (action === 'accept') {
    const result = await acceptSwapOffer(db, id, self.id, actor, scheduleUrl);
    switch (result.outcome) {
      case 'accepted':
        return json({ ok: true });
      case 'not-found':
        return json({ error: 'Swap offer not found' }, 404);
      case 'not-pending':
        return json({ error: `This offer was already ${result.status}` }, 409);
      case 'not-requester':
        return json({ error: 'Only the person who asked for the sub can accept a swap' }, 403);
      case 'sub-closed':
        return json(
          {
            error:
              result.status === 'claimed'
                ? 'Someone already took this shift'
                : 'This sub request was cancelled',
          },
          409
        );
      case 'shift-gone':
        return json({ error: 'One of the shifts no longer exists or was cancelled' }, 409);
      case 'past':
        return json({ error: 'One of the shifts is in the past' }, 400);
      case 'offerer-off-shift':
        return json({ error: "They're no longer on the shift they offered" }, 409);
      case 'already-on-offered':
        return json({ error: "You're already on the shift they offered" }, 409);
      case 'error':
        return dbError(result);
    }
  }

  const { data: offerRow, error: offerError } = await db
    .from('sub_swap_offers')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (offerError) return dbError(offerError);
  if (!offerRow) return json({ error: 'Swap offer not found' }, 404);
  const offer = offerRow as SubSwapOfferRow;
  if (offer.status !== 'pending') {
    return json({ error: `This offer was already ${offer.status}` }, 409);
  }

  const { data: subRow, error: subError } = await db
    .from('sub_requests')
    .select('*')
    .eq('id', offer.sub_request_id)
    .maybeSingle();
  if (subError) return dbError(subError);
  if (!subRow) return json({ error: 'Sub request not found' }, 404);
  const sub = subRow as SubRequestRow;

  if (action === 'withdraw' && offer.offerer_staff_id !== self.id) {
    return json({ error: 'You can only withdraw your own swap offers' }, 403);
  }
  if (
    action === 'decline' &&
    sub.requester_staff_id !== self.id &&
    !hasScheduleManage(gate.access)
  ) {
    return json({ error: 'Only the person who asked for the sub can decline a swap' }, 403);
  }

  // Same pending-only guard as accepting, so a decline can't race an accept.
  const status = action === 'withdraw' ? 'withdrawn' : 'declined';
  const { data: decidedRow, error: decideError } = await db
    .from('sub_swap_offers')
    .update({ status, decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();
  if (decideError) return dbError(decideError);
  if (!decidedRow) return json({ error: 'This offer was just decided' }, 409);
  const decided = decidedRow as SubSwapOfferRow;

  const { data: shiftRows } = await db
    .from('shifts')
    .select('id, label, shift_date, starts_at, ends_at')
    .in('id', [sub.shift_id, offer.offered_shift_id]);
  const shifts = (shiftRows ?? []) as ShiftForNotice[];
  const shift = shifts.find((s) => s.id === sub.shift_id) ?? null;
  const offeredShift = shifts.find((s) => s.id === offer.offered_shift_id) ?? null;

  const { data: offererRow } = await db
    .from('staff')
    .select('display_name')
    .eq('id', offer.offerer_staff_id)
    .maybeSingle();
  const offererName = (offererRow?.display_name as string | undefined) ?? 'Unknown staff';

  await logScheduleChange(db, {
    actor,
    entityType: 'swap_offer',
    entityId: offer.id,
    action: action === 'withdraw' ? 'discard' : 'deny',
    summary:
      action === 'withdraw'
        ? `${offererName} withdrew a swap offer on ${shift ? describeShift(shift) : 'a shift'}`
        : `${self.display_name} declined ${offererName}'s swap offer on ${shift ? describeShift(shift) : 'a shift'}`,
    details: { before: offer, after: decided },
  });

  if (action === 'decline' && shift) {
    await notifySubEvent(db, {
      event: 'swap_declined',
      subId: sub.id,
      shift,
      window: sub,
      requesterStaffId: sub.requester_staff_id,
      claimerStaffId: offer.offerer_staff_id,
      offeredShift,
      offeredWindow: offer,
      actorEmail: actor.email,
    });
  }

  return json({ ok: true });
};
