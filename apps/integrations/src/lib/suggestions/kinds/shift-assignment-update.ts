// shift_assignment.update: new hours for one person's assignment on a shift,
// when a note says they worked other hours than scheduled ("Sam and I stayed
// until 8:30"). Assignment times are what the timesheet pays, so this is the
// record that has to change; the shift's own window is left alone. Applied
// the way the schedule board re-times an assignment: change log entry, and
// a notice to the person when the shift is still ahead of them.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ShiftAssignmentRow, ShiftRow } from '@/lib/db';
import { notifyAssignmentChange } from '@/lib/notifications/schedule';
import { scheduleHref } from '@/lib/notifications/types';
import {
  changedFields,
  describeShift,
  logScheduleChange,
  staffNameOf,
  summarizeDiff,
  timeWindow,
} from '@/lib/schedule/change-log';
import { PAYLOAD_PARSERS, type ShiftTimesPayload } from '../types';
import type { KindHandler } from './handler';

type AssignmentLite = Pick<
  ShiftAssignmentRow,
  'id' | 'shift_id' | 'staff_id' | 'starts_at' | 'ends_at' | 'is_draft'
>;
type ShiftLite = Pick<
  ShiftRow,
  'id' | 'label' | 'shift_date' | 'starts_at' | 'ends_at' | 'status' | 'is_draft'
>;

async function loadAssignment(
  db: SupabaseClient,
  id: string
): Promise<{ assignment: AssignmentLite; shift: ShiftLite } | null> {
  const { data } = await db
    .from('shift_assignments')
    .select('id, shift_id, staff_id, starts_at, ends_at, is_draft')
    .eq('id', id)
    .maybeSingle();
  const assignment = data as AssignmentLite | null;
  if (!assignment) return null;
  const { data: shiftData } = await db
    .from('shifts')
    .select('id, label, shift_date, starts_at, ends_at, status, is_draft')
    .eq('id', assignment.shift_id)
    .maybeSingle();
  const shift = shiftData as ShiftLite | null;
  return shift ? { assignment, shift } : null;
}

const hm = (time: string) => time.slice(0, 5);

export const shiftAssignmentUpdate: KindHandler<'shift_assignment.update'> = {
  parse: PAYLOAD_PARSERS['shift_assignment.update'],

  async validate(db, payload) {
    const found = await loadAssignment(db, payload.assignmentId);
    if (!found) {
      return { ok: false, status: 404, error: `No assignment ${payload.assignmentId}` };
    }
    const { assignment, shift } = found;
    if (assignment.is_draft || shift.is_draft) {
      return {
        ok: false,
        status: 422,
        error: 'That assignment is still a draft; re-time it on the schedule board instead',
      };
    }
    if (shift.status !== 'active') {
      return { ok: false, status: 422, error: `${describeShift(shift)} was cancelled` };
    }

    const startsAt = payload.startsAt || hm(assignment.starts_at);
    const endsAt = payload.endsAt || hm(assignment.ends_at);
    if (endsAt <= startsAt) {
      return { ok: false, status: 422, error: 'endsAt must be after startsAt (same day)' };
    }
    if (startsAt === hm(assignment.starts_at) && endsAt === hm(assignment.ends_at)) {
      return {
        ok: false,
        status: 422,
        error: `That assignment is already ${timeWindow(assignment)}; nothing to change`,
      };
    }

    const value: ShiftTimesPayload = {
      assignmentId: assignment.id,
      startsAt,
      endsAt,
      staffName: await staffNameOf(db, assignment.staff_id),
      shiftId: shift.id,
      shiftLabel: shift.label,
      shiftDate: shift.shift_date,
      scheduledStartsAt: hm(assignment.starts_at),
      scheduledEndsAt: hm(assignment.ends_at),
    };
    return { ok: true, payload: value, target: { type: 'shift_assignment', id: assignment.id } };
  },

  async apply(db, payload, context) {
    const found = await loadAssignment(db, payload.assignmentId);
    if (!found) throw new Error('That assignment no longer exists');
    const { assignment: existing, shift } = found;
    const applied = {
      resultType: 'shift_assignment' as const,
      resultId: existing.id,
      label: `${payload.staffName}, ${payload.startsAt}–${payload.endsAt}`,
      href: scheduleHref(shift),
    };

    const fields = { starts_at: payload.startsAt, ends_at: payload.endsAt };
    // A retry after a crash finds the hours the first attempt set.
    const diff = changedFields(
      { starts_at: hm(existing.starts_at), ends_at: hm(existing.ends_at) },
      fields
    );
    if (!diff) return applied;

    const { data, error } = await db
      .from('shift_assignments')
      .update(fields)
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    const assignment = data as ShiftAssignmentRow;

    const from = context.origin ? ` (suggested from ${context.origin.label})` : ' (suggested)';
    await logScheduleChange(db, {
      actor: { kind: 'user', email: context.actor, label: context.actor },
      entityType: 'assignment',
      entityId: assignment.id,
      action: 'update',
      summary: `Updated ${payload.staffName}'s assignment on ${describeShift(shift)}: ${summarizeDiff(diff)}${from}`,
      details: { ...diff, suggestion_id: context.suggestion.id },
    });
    await notifyAssignmentChange(db, {
      change: 'updated',
      shift,
      staffId: assignment.staff_id,
      assignment,
      detail: summarizeDiff(diff),
      actorEmail: context.actor,
    });
    return applied;
  },
};
