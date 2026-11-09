// Swap offers on open sub requests, the second way to resolve one besides
// taking the shift outright (lib/schedule/sub.ts): a teammate offers one of
// their own upcoming shifts in exchange, and the requester accepts on the
// board. Accepting exchanges the two assignments — offerer onto the requested
// shift, requester onto the offered one — and closes the sub request as
// claimed by the offerer, using the same status-transition gates claiming
// does so a race (a plain take, a second accept, a cancel) loses cleanly.
//
// Shared by the board route (/api/admin/shift-swap) and the board payload
// (/api/admin/schedule-board), which precomputes each viewer's swappable
// shifts so the Offer a swap button only shows when there is something to
// offer.

import {
  availabilityFor,
  formatDutyList,
  isTrainedFor,
  timeToMinutes,
  todayEastern,
} from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ShiftAssignmentRow,
  ShiftRow,
  StaffRow,
  SubRequestRow,
  SubSwapOfferRow,
  TimeOffRow,
} from '@/lib/db';
import { sendToEach } from '@/lib/email/send-each';
import { notifySubEvent } from '@/lib/notifications/schedule';
import { type ChangeActor, describeShift, logScheduleChange } from '@/lib/schedule/change-log';
import { loadDutyCatalog, loadDutyTraining } from '@/lib/schedule/duties';
import {
  declinePendingOffersForSub,
  formatDateLabel,
  formatWindowLabel,
  listAdminRecipients,
} from '@/lib/schedule/sub';

/** A shift the viewer could put up in exchange for a requested one. */
export interface SwapCandidate {
  shiftId: string;
  label: string;
  shift_date: string;
  /** The viewer's own hours on it (what the requester would take over). */
  starts_at: string;
  ends_at: string;
}

type ShiftLite = Pick<
  ShiftRow,
  'id' | 'label' | 'shift_date' | 'starts_at' | 'ends_at' | 'status' | 'is_draft'
>;

/**
 * Which of the offerer's shifts can be offered against `sub` — pure, so the
 * rule is testable: a live, upcoming, non-draft assignment on an active shift
 * other than the requested one, that the requester isn't already on, has no
 * open sub request of the offerer's own, and is free for the requester per
 * their time off. The requester's own blackout from the sub request stays in
 * that check on purpose: a same-day overlapping shift is one they said they
 * can't work.
 */
export function swappableShifts(input: {
  sub: Pick<SubRequestRow, 'shift_id' | 'requester_staff_id'>;
  offererAssignments: Array<
    Pick<ShiftAssignmentRow, 'shift_id' | 'starts_at' | 'ends_at' | 'is_draft'>
  >;
  shiftsById: ReadonlyMap<string, ShiftLite>;
  /** Shifts the requester is already assigned to. */
  requesterShiftIds: ReadonlySet<string>;
  /** Shifts the offerer has their own open sub request on — not theirs to trade. */
  offererOpenSubShiftIds: ReadonlySet<string>;
  timeOff: TimeOffRow[];
  today: string;
}): SwapCandidate[] {
  const out: SwapCandidate[] = [];
  for (const a of input.offererAssignments) {
    if (a.is_draft) continue;
    if (a.shift_id === input.sub.shift_id) continue;
    if (input.requesterShiftIds.has(a.shift_id)) continue;
    if (input.offererOpenSubShiftIds.has(a.shift_id)) continue;
    const shift = input.shiftsById.get(a.shift_id);
    if (!shift || shift.status !== 'active' || shift.is_draft) continue;
    if (shift.shift_date < input.today) continue;
    const free =
      availabilityFor(
        input.timeOff,
        input.sub.requester_staff_id,
        shift.shift_date,
        timeToMinutes(a.starts_at),
        timeToMinutes(a.ends_at)
      ).status === 'free';
    if (!free) continue;
    out.push({
      shiftId: shift.id,
      label: shift.label,
      shift_date: shift.shift_date,
      starts_at: a.starts_at,
      ends_at: a.ends_at,
    });
  }
  return out.sort(
    (x, y) =>
      x.shift_date.localeCompare(y.shift_date) ||
      timeToMinutes(x.starts_at) - timeToMinutes(y.starts_at)
  );
}

/**
 * The offerer's swappable shifts for each of `subs`, keyed by sub id. Subs
 * the offerer made themselves get no entry. One round of reads for all of
 * them — the board calls this for every open sub in view.
 */
export async function loadSwapCandidates(
  db: SupabaseClient,
  input: { subs: SubRequestRow[]; offererId: string }
): Promise<Record<string, SwapCandidate[]>> {
  const subs = input.subs.filter(
    (s) => s.status === 'open' && s.requester_staff_id !== input.offererId
  );
  if (subs.length === 0) return {};
  const today = todayEastern();

  const [mineRes, timeOffRes, mySubsRes] = await Promise.all([
    db
      .from('shift_assignments')
      .select(
        'shift_id, starts_at, ends_at, is_draft, shifts!inner(id, label, shift_date, starts_at, ends_at, status, is_draft)'
      )
      .eq('staff_id', input.offererId)
      .eq('is_draft', false)
      .gte('shifts.shift_date', today),
    db.from('time_off').select('*'),
    db
      .from('sub_requests')
      .select('shift_id')
      .eq('requester_staff_id', input.offererId)
      .eq('status', 'open'),
  ]);
  const firstError = mineRes.error ?? timeOffRes.error ?? mySubsRes.error;
  if (firstError) throw new Error(firstError.message);

  type MineRow = Pick<ShiftAssignmentRow, 'shift_id' | 'starts_at' | 'ends_at' | 'is_draft'> & {
    shifts: ShiftLite;
  };
  const mine = (mineRes.data ?? []) as unknown as MineRow[];
  const shiftsById = new Map(mine.map((m) => [m.shifts.id, m.shifts]));
  const timeOff = (timeOffRes.data ?? []) as TimeOffRow[];
  const offererOpenSubShiftIds = new Set(
    ((mySubsRes.data ?? []) as Array<{ shift_id: string }>).map((r) => r.shift_id)
  );

  // Where each requester already works among the offerer's shifts.
  const requesterIds = [...new Set(subs.map((s) => s.requester_staff_id))];
  const requesterShiftIds = new Map<string, Set<string>>();
  if (shiftsById.size > 0) {
    const { data, error } = await db
      .from('shift_assignments')
      .select('staff_id, shift_id')
      .in('staff_id', requesterIds)
      .in('shift_id', [...shiftsById.keys()]);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<{ staff_id: string; shift_id: string }>) {
      const set = requesterShiftIds.get(row.staff_id) ?? new Set<string>();
      set.add(row.shift_id);
      requesterShiftIds.set(row.staff_id, set);
    }
  }

  const out: Record<string, SwapCandidate[]> = {};
  for (const sub of subs) {
    const candidates = swappableShifts({
      sub,
      offererAssignments: mine,
      shiftsById,
      requesterShiftIds: requesterShiftIds.get(sub.requester_staff_id) ?? new Set(),
      offererOpenSubShiftIds,
      timeOff,
      today,
    });
    if (candidates.length > 0) out[sub.id] = candidates;
  }
  return out;
}

export type AcceptSwapOutcome =
  | { outcome: 'accepted'; offer: SubSwapOfferRow; sub: SubRequestRow; shift: ShiftRow }
  | { outcome: 'not-found' }
  | { outcome: 'not-pending'; status: SubSwapOfferRow['status'] }
  | { outcome: 'not-requester' }
  | { outcome: 'sub-closed'; status: SubRequestRow['status'] }
  | { outcome: 'shift-gone' }
  | { outcome: 'past' }
  | { outcome: 'offerer-off-shift' }
  | { outcome: 'already-on-offered' }
  | { outcome: 'error'; message: string };

/**
 * Accept a pending swap offer as `accepterId` (who must be the sub's
 * requester): the offer flips to accepted and the sub request to claimed
 * (two atomic gates — the second losing undoes the first), then the four
 * assignment writes run with manual rollback of whatever completed. Other
 * pending offers on the sub are declined, both sides are logged, the offerer
 * and the admins are told in the dashboard, and the admins plus the offerer
 * get an email.
 */
export async function acceptSwapOffer(
  db: SupabaseClient,
  offerId: string,
  accepterId: string,
  actor: ChangeActor,
  scheduleUrl: string
): Promise<AcceptSwapOutcome> {
  const { data: offerRow, error: offerError } = await db
    .from('sub_swap_offers')
    .select('*')
    .eq('id', offerId)
    .maybeSingle();
  if (offerError) return { outcome: 'error', message: offerError.message };
  if (!offerRow) return { outcome: 'not-found' };
  const offer = offerRow as SubSwapOfferRow;
  if (offer.status !== 'pending') return { outcome: 'not-pending', status: offer.status };

  const { data: subRow, error: subError } = await db
    .from('sub_requests')
    .select('*')
    .eq('id', offer.sub_request_id)
    .maybeSingle();
  if (subError) return { outcome: 'error', message: subError.message };
  if (!subRow) return { outcome: 'not-found' };
  const sub = subRow as SubRequestRow;
  if (sub.requester_staff_id !== accepterId) return { outcome: 'not-requester' };
  if (sub.status !== 'open') return { outcome: 'sub-closed', status: sub.status };

  const { data: shiftRows, error: shiftError } = await db
    .from('shifts')
    .select('*')
    .in('id', [sub.shift_id, offer.offered_shift_id]);
  if (shiftError) return { outcome: 'error', message: shiftError.message };
  const shifts = (shiftRows ?? []) as ShiftRow[];
  const shift = shifts.find((s) => s.id === sub.shift_id) ?? null;
  const offeredShift = shifts.find((s) => s.id === offer.offered_shift_id) ?? null;
  for (const s of [shift, offeredShift]) {
    if (!s || s.status !== 'active' || s.is_draft) return { outcome: 'shift-gone' };
    if (s.shift_date < todayEastern()) return { outcome: 'past' };
  }
  if (!shift || !offeredShift) return { outcome: 'shift-gone' };

  // The offerer must still hold what they offered, and the requester must
  // not already be on it (the unique key would reject the insert anyway).
  const { data: offeredRows, error: offeredError } = await db
    .from('shift_assignments')
    .select('*')
    .eq('shift_id', offer.offered_shift_id)
    .in('staff_id', [offer.offerer_staff_id, sub.requester_staff_id])
    .eq('is_draft', false);
  if (offeredError) return { outcome: 'error', message: offeredError.message };
  const offeredAssignments = (offeredRows ?? []) as ShiftAssignmentRow[];
  const offererOnOffered = offeredAssignments.find((a) => a.staff_id === offer.offerer_staff_id);
  if (!offererOnOffered) return { outcome: 'offerer-off-shift' };
  if (offeredAssignments.some((a) => a.staff_id === sub.requester_staff_id)) {
    return { outcome: 'already-on-offered' };
  }

  // Each side carries the other's duties, minus any needing training they
  // don't have — those stay with nobody, and the admins are told.
  const dutyCatalog = await loadDutyCatalog(db);
  let dutyTraining: Awaited<ReturnType<typeof loadDutyTraining>>;
  try {
    dutyTraining = await loadDutyTraining(db);
  } catch (e) {
    return { outcome: 'error', message: e instanceof Error ? e.message : String(e) };
  }
  const carriedToOfferer = sub.duties.filter((key) =>
    isTrainedFor(dutyCatalog, dutyTraining, offer.offerer_staff_id, key)
  );
  const droppedForOfferer = sub.duties.filter((key) => !carriedToOfferer.includes(key));
  // The offered shift's duties as they stand now, not the offer-time snapshot
  // — a manager may have changed them since.
  const carriedToRequester = offererOnOffered.duties.filter((key) =>
    isTrainedFor(dutyCatalog, dutyTraining, sub.requester_staff_id, key)
  );
  const droppedForRequester = offererOnOffered.duties.filter(
    (key) => !carriedToRequester.includes(key)
  );

  // Gate 1: the offer. Only one caller moves pending -> accepted.
  const now = new Date().toISOString();
  const { data: acceptedRow, error: acceptError } = await db
    .from('sub_swap_offers')
    .update({ status: 'accepted', decided_at: now })
    .eq('id', offerId)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();
  if (acceptError) return { outcome: 'error', message: acceptError.message };
  if (!acceptedRow) {
    const { data: lost } = await db
      .from('sub_swap_offers')
      .select('status')
      .eq('id', offerId)
      .maybeSingle();
    return {
      outcome: 'not-pending',
      status: (lost?.status as SubSwapOfferRow['status'] | undefined) ?? 'declined',
    };
  }
  const accepted = acceptedRow as SubSwapOfferRow;

  // Supabase builders are thenables, not Promises — awaited in rollback().
  const undo: Array<() => PromiseLike<unknown>> = [
    () =>
      db.from('sub_swap_offers').update({ status: 'pending', decided_at: null }).eq('id', offerId),
  ];
  const rollback = async () => {
    for (const step of undo.reverse()) {
      try {
        await step();
      } catch (e) {
        console.error('[shift-swap] rollback step failed:', e instanceof Error ? e.message : e);
      }
    }
  };

  // Gate 2: the sub request, same transition a plain claim uses, so a take
  // racing this accept can't both win.
  const { data: claimedRow, error: claimError } = await db
    .from('sub_requests')
    .update({ status: 'claimed', claimed_by_staff_id: offer.offerer_staff_id, claimed_at: now })
    .eq('id', sub.id)
    .eq('status', 'open')
    .select('*')
    .maybeSingle();
  if (claimError) {
    await rollback();
    return { outcome: 'error', message: claimError.message };
  }
  if (!claimedRow) {
    await rollback();
    const { data: lost } = await db
      .from('sub_requests')
      .select('status')
      .eq('id', sub.id)
      .maybeSingle();
    return {
      outcome: 'sub-closed',
      status: (lost?.status as SubRequestRow['status'] | undefined) ?? 'claimed',
    };
  }
  const claimed = claimedRow as SubRequestRow;
  undo.push(() =>
    db
      .from('sub_requests')
      .update({ status: 'open', claimed_by_staff_id: null, claimed_at: null })
      .eq('id', sub.id)
  );

  // The four assignment writes. Each completed step gets an undo so a later
  // failure puts the board back exactly as it was.
  const fail = async (message: string): Promise<AcceptSwapOutcome> => {
    await rollback();
    return { outcome: 'error', message };
  };

  const { data: removedRequesterRows, error: removeRequesterError } = await db
    .from('shift_assignments')
    .delete()
    .eq('shift_id', sub.shift_id)
    .eq('staff_id', sub.requester_staff_id)
    .select('*');
  if (removeRequesterError) return fail(removeRequesterError.message);
  const removedRequester = (removedRequesterRows ?? [])[0] as ShiftAssignmentRow | undefined;
  if (removedRequester) {
    const { id: _id, ...restore } = removedRequester;
    undo.push(() => db.from('shift_assignments').insert(restore));
  }

  const { data: offererOnSubRow, error: offererOnSubError } = await db
    .from('shift_assignments')
    .insert({
      shift_id: sub.shift_id,
      staff_id: offer.offerer_staff_id,
      starts_at: sub.starts_at,
      ends_at: sub.ends_at,
      duties: carriedToOfferer,
      notes: null,
    })
    .select('*')
    .single();
  if (offererOnSubError) return fail(offererOnSubError.message);
  const offererOnSub = offererOnSubRow as ShiftAssignmentRow;
  undo.push(() => db.from('shift_assignments').delete().eq('id', offererOnSub.id));

  const { error: removeOffererError } = await db
    .from('shift_assignments')
    .delete()
    .eq('id', offererOnOffered.id);
  if (removeOffererError) return fail(removeOffererError.message);
  {
    const { id: _id, ...restore } = offererOnOffered;
    undo.push(() => db.from('shift_assignments').insert(restore));
  }

  const { data: requesterOnOfferedRow, error: requesterOnOfferedError } = await db
    .from('shift_assignments')
    .insert({
      shift_id: offer.offered_shift_id,
      staff_id: sub.requester_staff_id,
      starts_at: offererOnOffered.starts_at,
      ends_at: offererOnOffered.ends_at,
      duties: carriedToRequester,
      notes: null,
    })
    .select('*')
    .single();
  if (requesterOnOfferedError) return fail(requesterOnOfferedError.message);
  const requesterOnOffered = requesterOnOfferedRow as ShiftAssignmentRow;

  // Any other offers on this sub are moot now.
  await declinePendingOffersForSub(db, sub.id);

  const { data: peopleRows } = await db
    .from('staff')
    .select('id, display_name, email')
    .in('id', [sub.requester_staff_id, offer.offerer_staff_id]);
  const people = (peopleRows ?? []) as Array<Pick<StaffRow, 'id' | 'display_name' | 'email'>>;
  const requester = people.find((p) => p.id === sub.requester_staff_id);
  const offerer = people.find((p) => p.id === offer.offerer_staff_id);
  const requesterName = requester?.display_name ?? 'Unknown staff';
  const offererName = offerer?.display_name ?? 'Unknown staff';
  const shiftDesc = describeShift(shift);
  const offeredDesc = describeShift(offeredShift);
  const droppedOffererLabel =
    droppedForOfferer.length > 0 ? formatDutyList(dutyCatalog, droppedForOfferer) : null;
  const droppedRequesterLabel =
    droppedForRequester.length > 0 ? formatDutyList(dutyCatalog, droppedForRequester) : null;

  await logScheduleChange(db, {
    actor,
    entityType: 'swap_offer',
    entityId: accepted.id,
    action: 'approve',
    summary: `${requesterName} accepted ${offererName}'s swap: ${offererName} takes ${shiftDesc}, ${requesterName} takes ${offeredDesc}`,
    details: { before: offer, after: accepted, sub: claimed },
  });
  await logScheduleChange(db, {
    actor,
    entityType: 'assignment',
    entityId: offererOnSub.id,
    action: 'create',
    summary: `Assigned ${offererName} to ${shiftDesc} (swap with ${requesterName})${
      droppedOffererLabel
        ? `; not trained on ${droppedOffererLabel}, so it was left unassigned`
        : ''
    }`,
    details: { before: removedRequester ?? null, after: offererOnSub },
  });
  await logScheduleChange(db, {
    actor,
    entityType: 'assignment',
    entityId: requesterOnOffered.id,
    action: 'create',
    summary: `Assigned ${requesterName} to ${offeredDesc} (swap with ${offererName})${
      droppedRequesterLabel
        ? `; not trained on ${droppedRequesterLabel}, so it was left unassigned`
        : ''
    }`,
    details: { before: offererOnOffered, after: requesterOnOffered },
  });

  await notifySubEvent(db, {
    event: 'swap_accepted',
    subId: claimed.id,
    shift,
    window: sub,
    requesterStaffId: sub.requester_staff_id,
    claimerStaffId: offer.offerer_staff_id,
    offeredShift,
    offeredWindow: offererOnOffered,
    actorEmail: actor.email,
  });

  // Close the loop for the admins and the offerer — best-effort per recipient.
  const recipients = new Set(await listAdminRecipients());
  if (offerer?.email) recipients.add(offerer.email.toLowerCase());
  const props = {
    offererName,
    requesterName,
    shiftLabel: shift.label,
    dateLabel: formatDateLabel(shift.shift_date),
    timeLabel: formatWindowLabel(sub),
    offeredShiftLabel: offeredShift.label,
    offeredDateLabel: formatDateLabel(offeredShift.shift_date),
    offeredTimeLabel: formatWindowLabel(offererOnOffered),
    scheduleUrl,
    ...(droppedOffererLabel && { untrainedDuties: droppedOffererLabel }),
    ...(droppedRequesterLabel && { untrainedOfferedDuties: droppedRequesterLabel }),
  };
  await sendToEach(
    [...recipients],
    () => ({ template: 'sub-swap-accepted-notice', props, kind: 'transactional' }),
    'shift-swap'
  );

  return { outcome: 'accepted', offer: accepted, sub: claimed, shift };
}
