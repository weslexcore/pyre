// Server side of the on-call rule (the rule itself is planOnCall in
// schedule-core on-call.ts): load what it reads, write what it decides, and
// the two places it runs beyond the board's Auto on-call button —
//   - recommendOnCall: a draft proposal's on-call, worked out from the draft
//     as if it were already live, stored on the proposal for review.
//   - fillOnCall after a proposal is approved (or resolves item by item): the
//     week is re-planned from what actually went live, so a rejected item
//     can't leave a stale recommendation behind.
// Hand-picked shifts (on_call_manual) are never touched, and nothing before
// today is rewritten.

import {
  addDays,
  ON_CALL_LOOKBACK_DAYS,
  type OnCallChange,
  type OnCallPerson,
  type OnCallShift,
  planOnCall,
  utcToEastern,
} from '@pyre/schedule-core';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { TimeOffRow } from '@/lib/db';
import { type ChangeActor, describeShift, logScheduleChange } from '@/lib/schedule/change-log';

export const todayEastern = (): string => utcToEastern(new Date().toISOString()).date;

export interface OnCallInputs {
  shifts: Array<OnCallShift & { label: string }>;
  people: OnCallPerson[];
  timeOff: TimeOffRow[];
}

/**
 * Everything planOnCall needs for `fromDate`..`end`: the live shifts with
 * their live assignments (plus the lookback the split counts), the roster,
 * and time off.
 */
export async function loadOnCallInputs(
  db: SupabaseClient,
  fromDate: string,
  end: string
): Promise<OnCallInputs | { error: PostgrestError }> {
  const [shiftsRes, staffRes, timeOffRes] = await Promise.all([
    db
      .from('shifts')
      .select(
        'id, shift_date, label, starts_at, ends_at, status, is_draft, on_call_staff_id, on_call_manual'
      )
      .gte('shift_date', addDays(fromDate, -ON_CALL_LOOKBACK_DAYS))
      .lte('shift_date', end)
      .eq('is_draft', false)
      .eq('status', 'active'),
    db.from('staff').select('id, display_name, active, on_call_eligible'),
    db.from('time_off').select('*'),
  ]);
  const firstError = shiftsRes.error ?? staffRes.error ?? timeOffRes.error;
  if (firstError) return { error: firstError };

  const shifts = (
    (shiftsRes.data ?? []) as Array<Omit<OnCallShift, 'assignments'> & { label: string }>
  ).map((s) => ({
    ...s,
    assignments: [] as Array<{ staff_id: string; is_draft: boolean }>,
  }));
  if (shifts.length > 0) {
    const { data, error } = await db
      .from('shift_assignments')
      .select('shift_id, staff_id, is_draft')
      .in(
        'shift_id',
        shifts.map((s) => s.id)
      )
      .eq('is_draft', false);
    if (error) return { error };
    const byId = new Map(shifts.map((s) => [s.id, s]));
    for (const a of (data ?? []) as Array<{
      shift_id: string;
      staff_id: string;
      is_draft: boolean;
    }>) {
      byId.get(a.shift_id)?.assignments.push({ staff_id: a.staff_id, is_draft: a.is_draft });
    }
  }

  return {
    shifts,
    people: (staffRes.data ?? []) as OnCallPerson[],
    timeOff: (timeOffRes.data ?? []) as TimeOffRow[],
  };
}

/**
 * Write the planned changes, grouped by who they name. Hand-picked shifts are
 * filtered in the update itself, so a pick made while the plan ran survives.
 */
export async function applyOnCallChanges(
  db: SupabaseClient,
  changes: OnCallChange[]
): Promise<PostgrestError | null> {
  const byTarget = new Map<string | null, string[]>();
  for (const c of changes) {
    const ids = byTarget.get(c.to) ?? [];
    ids.push(c.shiftId);
    byTarget.set(c.to, ids);
  }
  for (const [to, ids] of byTarget) {
    const { error } = await db
      .from('shifts')
      .update({ on_call_staff_id: to })
      .in('id', ids)
      .eq('on_call_manual', false);
    if (error) return error;
  }
  return null;
}

/** Change-log detail for a batch of on-call changes, with names. */
function describeChanges(changes: OnCallChange[], inputs: OnCallInputs) {
  const names = new Map(inputs.people.map((p) => [p.id, p.display_name]));
  const shifts = new Map(inputs.shifts.map((s) => [s.id, s]));
  return changes.map((c) => {
    const shift = shifts.get(c.shiftId);
    return {
      shiftId: c.shiftId,
      shift: shift ? describeShift(shift) : null,
      from: c.from ? (names.get(c.from) ?? c.from) : null,
      to: c.to ? (names.get(c.to) ?? c.to) : null,
      reason: c.reason,
    };
  });
}

/**
 * Run the rule over `start`..`end` (today onward) and write it. Returns what
 * changed and how many live shifts were left with nobody on call.
 */
export async function fillOnCall(
  db: SupabaseClient,
  opts: { start: string; end: string; actor: ChangeActor; why: string }
): Promise<{ changed: number; unfilled: number } | { error: PostgrestError }> {
  const today = todayEastern();
  const fromDate = opts.start > today ? opts.start : today;
  if (fromDate > opts.end) return { changed: 0, unfilled: 0 };

  const inputs = await loadOnCallInputs(db, fromDate, opts.end);
  if ('error' in inputs) return inputs;

  const changes = planOnCall({ ...inputs, fromDate });
  const applyError = await applyOnCallChanges(db, changes);
  if (applyError) return { error: applyError };

  const changedTo = new Map(changes.map((c) => [c.shiftId, c.to]));
  const unfilled = inputs.shifts.filter(
    (s) =>
      s.shift_date >= fromDate &&
      (changedTo.has(s.id) ? changedTo.get(s.id) : s.on_call_staff_id) === null
  ).length;

  if (changes.length > 0) {
    await logScheduleChange(db, {
      actor: opts.actor,
      entityType: 'shift',
      entityId: null,
      action: 'update',
      summary: `${opts.why}: on-call for ${changes.length} shift${changes.length === 1 ? '' : 's'} (${fromDate} – ${opts.end})`,
      details: { changes: describeChanges(changes, inputs) },
    });
  }
  return { changed: changes.length, unfilled };
}

/** One shift's recommended on-call in a draft, as stored on the proposal. */
export interface OnCallRecommendation {
  shiftId: string;
  /** Who the draft would put on call; null = nobody on call is free. */
  staffId: string | null;
  /** Their name, for the drafter's save result and the change log. */
  name: string | null;
  reason: OnCallChange['reason'];
}

/**
 * The on-call a draft week would get if approved as-is: the live week plus
 * the draft's new shifts and assignments, planned as if all of it were live.
 * Only shifts whose on-call would change are returned.
 */
export async function recommendOnCall(
  db: SupabaseClient,
  weekStart: string,
  draft: {
    shifts: Array<{
      id: string;
      shift_date: string;
      starts_at: string;
      ends_at: string;
      label: string;
    }>;
    assignments: Array<{ shiftId: string; staffId: string }>;
  }
): Promise<OnCallRecommendation[] | { error: PostgrestError }> {
  const weekEnd = addDays(weekStart, 6);
  const today = todayEastern();
  const fromDate = weekStart > today ? weekStart : today;
  if (fromDate > weekEnd) return [];

  const inputs = await loadOnCallInputs(db, fromDate, weekEnd);
  if ('error' in inputs) return inputs;

  const shifts = [
    ...inputs.shifts.map((s) => ({ ...s, assignments: [...s.assignments] })),
    ...draft.shifts.map((s) => ({
      ...s,
      status: 'active' as const,
      is_draft: false,
      on_call_staff_id: null,
      on_call_manual: false,
      assignments: [] as Array<{ staff_id: string; is_draft: boolean }>,
    })),
  ];
  const byId = new Map(shifts.map((s) => [s.id, s]));
  for (const a of draft.assignments) {
    byId.get(a.shiftId)?.assignments.push({ staff_id: a.staffId, is_draft: false });
  }

  const names = new Map(inputs.people.map((p) => [p.id, p.display_name]));
  return planOnCall({ shifts, people: inputs.people, timeOff: inputs.timeOff, fromDate }).map(
    (c) => ({
      shiftId: c.shiftId,
      staffId: c.to,
      name: c.to ? (names.get(c.to) ?? null) : null,
      reason: c.reason,
    })
  );
}
