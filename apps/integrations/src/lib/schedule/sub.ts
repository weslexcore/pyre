// Sub-request engine shared by the authed board route (/api/admin/shift-sub)
// and the signed email claim link (/api/schedule/sub-claim): claiming an open
// sub request swaps the shift assignment from the requester to the claimer,
// with the status transition as the first-come-first-served gate. Also the
// home of the small formatting helpers the sub emails use.

import { timeToMinutes, utcToEastern } from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ShiftAssignmentRow, ShiftRow, StaffRow, SubRequestRow } from '@/lib/db';
import { sendTemplate } from '@/lib/email/send';
import { type ChangeActor, describeShift, logScheduleChange } from '@/lib/schedule/change-log';

/** "Thursday, August 14" from YYYY-MM-DD (dates are already ET wall-clock). */
export const formatDateLabel = (date: string): string =>
  new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

/** "2:30p" from HH:MM[:SS], matching the boards' compact time style. */
export const formatTimeLabel = (t: string): string => {
  const min = timeToMinutes(t);
  const h = Math.floor(min / 60);
  const m = min % 60;
  const suffix = h < 12 ? 'a' : 'p';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, '0')}${suffix}`;
};

/** "2:30p–8:30p" */
export const formatWindowLabel = (row: { starts_at: string; ends_at: string }): string =>
  `${formatTimeLabel(row.starts_at)}–${formatTimeLabel(row.ends_at)}`;

/** Today's date in the schedule's wall-clock timezone (America/New_York). */
export const todayEastern = (): string => utcToEastern(new Date().toISOString()).date;

/** Everyone with a dashboard admin flag and an email — the notice audience. */
export async function listAdminRecipients(db: SupabaseClient): Promise<StaffRow[]> {
  const { data } = await db.from('staff').select('*');
  return ((data ?? []) as StaffRow[]).filter((s) => s.is_admin && s.email);
}

export type ClaimOutcome =
  | { outcome: 'claimed'; sub: SubRequestRow; shift: ShiftRow }
  | { outcome: 'already-claimed'; byName: string | null }
  | { outcome: 'cancelled' }
  | { outcome: 'not-found' }
  | { outcome: 'shift-gone' }
  | { outcome: 'past' }
  | { outcome: 'own-request' }
  | { outcome: 'already-assigned' }
  | { outcome: 'error'; message: string };

/**
 * Claim an open sub request for `claimerId`: flips the row to claimed (the
 * atomic first-come-first-served gate), swaps the assignment from the
 * requester to the claimer, logs both sides, and emails the admins that
 * cover was found. The caller has already authenticated the claimer (session
 * or signed link).
 */
export async function claimSubRequest(
  db: SupabaseClient,
  subRequestId: string,
  claimerId: string,
  actor: ChangeActor,
  scheduleUrl: string
): Promise<ClaimOutcome> {
  const { data: subRow, error: subError } = await db
    .from('sub_requests')
    .select('*')
    .eq('id', subRequestId)
    .maybeSingle();
  if (subError) return { outcome: 'error', message: subError.message };
  if (!subRow) return { outcome: 'not-found' };
  const sub = subRow as SubRequestRow;

  if (sub.status === 'cancelled') return { outcome: 'cancelled' };
  if (sub.status === 'claimed') {
    return { outcome: 'already-claimed', byName: await nameOf(db, sub.claimed_by_staff_id) };
  }
  if (sub.requester_staff_id === claimerId) return { outcome: 'own-request' };

  const { data: shiftRow, error: shiftError } = await db
    .from('shifts')
    .select('*')
    .eq('id', sub.shift_id)
    .maybeSingle();
  if (shiftError) return { outcome: 'error', message: shiftError.message };
  const shift = shiftRow as ShiftRow | null;
  if (!shift || shift.status !== 'active') return { outcome: 'shift-gone' };
  if (shift.shift_date < todayEastern()) return { outcome: 'past' };

  const { data: existing, error: existingError } = await db
    .from('shift_assignments')
    .select('id')
    .eq('shift_id', sub.shift_id)
    .eq('staff_id', claimerId)
    .maybeSingle();
  if (existingError) return { outcome: 'error', message: existingError.message };
  if (existing) return { outcome: 'already-assigned' };

  // The status transition is the claim gate: only one caller can move
  // open -> claimed, so a second click loses here rather than double-swapping.
  const { data: claimedRow, error: claimError } = await db
    .from('sub_requests')
    .update({
      status: 'claimed',
      claimed_by_staff_id: claimerId,
      claimed_at: new Date().toISOString(),
    })
    .eq('id', subRequestId)
    .eq('status', 'open')
    .select('*')
    .maybeSingle();
  if (claimError) return { outcome: 'error', message: claimError.message };
  if (!claimedRow) {
    const { data: lost } = await db
      .from('sub_requests')
      .select('claimed_by_staff_id')
      .eq('id', subRequestId)
      .maybeSingle();
    return {
      outcome: 'already-claimed',
      byName: await nameOf(db, (lost?.claimed_by_staff_id as string | null) ?? null),
    };
  }
  const claimed = claimedRow as SubRequestRow;

  // Swap: requester off (their assignment may already be gone — fine), the
  // claimer on with the window/role captured at request time.
  const { data: removedRows, error: removeError } = await db
    .from('shift_assignments')
    .delete()
    .eq('shift_id', sub.shift_id)
    .eq('staff_id', sub.requester_staff_id)
    .select('*');
  if (removeError) return { outcome: 'error', message: removeError.message };
  const removed = (removedRows ?? [])[0] as ShiftAssignmentRow | undefined;

  const { data: insertedRow, error: insertError } = await db
    .from('shift_assignments')
    .insert({
      shift_id: sub.shift_id,
      staff_id: claimerId,
      starts_at: sub.starts_at,
      ends_at: sub.ends_at,
      role: sub.role,
      notes: null,
    })
    .select('*')
    .single();
  if (insertError) {
    // Put things back the way they were so the request stays claimable.
    if (removed) {
      const { id: _dropped, ...restore } = removed;
      await db.from('shift_assignments').insert(restore);
    }
    await db
      .from('sub_requests')
      .update({ status: 'open', claimed_by_staff_id: null, claimed_at: null })
      .eq('id', subRequestId);
    return { outcome: 'error', message: insertError.message };
  }
  const assignment = insertedRow as ShiftAssignmentRow;

  const requesterName = (await nameOf(db, sub.requester_staff_id)) ?? 'Unknown staff';
  const claimerName = (await nameOf(db, claimerId)) ?? 'Unknown staff';
  const shiftDesc = describeShift(shift);

  await logScheduleChange(db, {
    actor,
    entityType: 'sub_request',
    entityId: claimed.id,
    action: 'approve',
    summary: `${claimerName} took ${requesterName}'s ${shiftDesc} (sub claimed)`,
    details: { before: sub, after: claimed },
  });
  await logScheduleChange(db, {
    actor,
    entityType: 'assignment',
    entityId: assignment.id,
    action: 'create',
    summary: `Assigned ${claimerName} to ${shiftDesc} (sub for ${requesterName})`,
    details: { before: removed ?? null, after: assignment },
  });

  // Close the loop for the admins — best-effort per recipient.
  const props = {
    takerName: claimerName,
    requesterName,
    shiftLabel: shift.label,
    dateLabel: formatDateLabel(shift.shift_date),
    timeLabel: formatWindowLabel(sub),
    scheduleUrl,
  };
  for (const admin of await listAdminRecipients(db)) {
    try {
      await sendTemplate({
        to: admin.email as string,
        template: 'sub-claimed-notice',
        props,
        kind: 'transactional',
      });
    } catch (e) {
      console.error(
        `[shift-sub] claim notify ${admin.email} failed:`,
        e instanceof Error ? e.message : e
      );
    }
  }

  return { outcome: 'claimed', sub: claimed, shift };
}

async function nameOf(db: SupabaseClient, staffId: string | null): Promise<string | null> {
  if (!staffId) return null;
  const { data } = await db.from('staff').select('display_name').eq('id', staffId).maybeSingle();
  return (data?.display_name as string | undefined) ?? null;
}
