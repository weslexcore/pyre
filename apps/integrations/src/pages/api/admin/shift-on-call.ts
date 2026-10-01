// Who's on call for each shift (shifts.on_call_staff_id), for /admin/schedule.
//   POST  { start, end }            — Auto on-call: fill every live shift in
//                                     the range, today onward, by the rule in
//                                     schedule-core on-call.ts. Hand-picked
//                                     shifts are left alone.
//   PATCH { id, staffId }           — pick by hand (staffId null = nobody);
//                                     the auto action then skips the shift
//   PATCH { id, auto: true }        — hand the shift back to the rule
//
// Reads come from schedule-board (the columns ride on the shift rows). All
// writes need schedule:manage, like every other change to a shift.

import {
  addDays,
  ON_CALL_LOOKBACK_DAYS,
  type OnCallChange,
  type OnCallPerson,
  type OnCallShift,
  onCallPeople,
  planOnCall,
  utcToEastern,
} from '@pyre/schedule-core';
import type { APIRoute } from 'astro';
import { requireScheduleManage } from '@/lib/auth/admin';
import { getDb, type ShiftRow, type TimeOffRow } from '@/lib/db';
import { dbError, gateMutation, json, readJsonBody } from '@/lib/http/route';
import { actorFromGate, describeShift, logScheduleChange } from '@/lib/schedule/change-log';

export const prerender = false;

type Db = NonNullable<ReturnType<typeof getDb>>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A month view plus slack; the auto action is never asked for more. */
const MAX_RANGE_DAYS = 45;

const todayEastern = () => utcToEastern(new Date().toISOString()).date;

function daysBetween(start: string, end: string): number {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000
  );
}

/**
 * Everything planOnCall needs for `fromDate`..`end`: the live shifts with
 * their live assignments (plus the lookback the split counts), the roster,
 * and time off.
 */
async function loadPlanInputs(
  db: Db,
  fromDate: string,
  end: string
): Promise<{ shifts: OnCallShift[]; people: OnCallPerson[]; timeOff: TimeOffRow[] } | Response> {
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
  if (firstError) return dbError(firstError);

  const shifts = ((shiftsRes.data ?? []) as Array<Omit<OnCallShift, 'assignments'>>).map((s) => ({
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
    if (error) return dbError(error);
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
async function applyChanges(db: Db, changes: OnCallChange[]): Promise<Response | null> {
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
    if (error) return dbError(error);
  }
  return null;
}

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await gateMutation(cookies, request, requireScheduleManage);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const { start, end } = body;
  if (
    typeof start !== 'string' ||
    !DATE_RE.test(start) ||
    typeof end !== 'string' ||
    !DATE_RE.test(end) ||
    end < start
  ) {
    return json({ error: 'start and end must be YYYY-MM-DD with end >= start' }, 400);
  }
  if (daysBetween(start, end) > MAX_RANGE_DAYS) {
    return json({ error: `Pick a range of at most ${MAX_RANGE_DAYS} days` }, 400);
  }

  // Past shifts are a record of who was on call — never rewritten.
  const today = todayEastern();
  const fromDate = start > today ? start : today;
  if (fromDate > end) return json({ changed: 0, unfilled: 0 });

  const inputs = await loadPlanInputs(db, fromDate, end);
  if (inputs instanceof Response) return inputs;
  if (onCallPeople(inputs.people).length === 0) {
    return json({ error: 'Nobody is set up to be on call — tick "On call" on /admin/users' }, 400);
  }

  const changes = planOnCall({ ...inputs, fromDate });
  const applyError = await applyChanges(db, changes);
  if (applyError) return applyError;

  // Live shifts in range left with nobody — everyone on call was off.
  const changedTo = new Map(changes.map((c) => [c.shiftId, c.to]));
  const unfilled = inputs.shifts.filter(
    (s) =>
      s.shift_date >= fromDate &&
      (changedTo.has(s.id) ? changedTo.get(s.id) : s.on_call_staff_id) === null
  ).length;

  if (changes.length > 0) {
    const names = new Map(inputs.people.map((p) => [p.id, p.display_name]));
    const labels = new Map(
      (inputs.shifts as Array<OnCallShift & { label: string }>).map((s) => [s.id, s])
    );
    await logScheduleChange(db, {
      actor: actorFromGate(gate),
      entityType: 'shift',
      entityId: null,
      action: 'update',
      summary: `Auto-filled on-call for ${changes.length} shift${changes.length === 1 ? '' : 's'} (${fromDate} – ${end})`,
      details: {
        changes: changes.map((c) => {
          const shift = labels.get(c.shiftId);
          return {
            shiftId: c.shiftId,
            shift: shift ? describeShift(shift) : null,
            from: c.from ? (names.get(c.from) ?? c.from) : null,
            to: c.to ? (names.get(c.to) ?? c.to) : null,
            reason: c.reason,
          };
        }),
      },
    });
  }

  return json({ changed: changes.length, unfilled });
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const gate = await gateMutation(cookies, request, requireScheduleManage);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const id = body.id;
  if (typeof id !== 'string' || !id) return json({ error: 'id is required' }, 400);
  const auto = body.auto === true;
  if (!auto && body.staffId !== null && typeof body.staffId !== 'string') {
    return json({ error: 'staffId (or null) or auto: true is required' }, 400);
  }

  const { data: existing, error: fetchError } = await db
    .from('shifts')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) return dbError(fetchError);
  if (!existing) return json({ error: 'Shift not found' }, 404);
  const shift = existing as ShiftRow;
  if (shift.is_draft) {
    return json({ error: 'Accept the draft shift before choosing who is on call' }, 400);
  }

  let fields: Pick<ShiftRow, 'on_call_staff_id' | 'on_call_manual'>;
  if (auto) {
    // Back to the rule: plan this shift as the auto action would, from its
    // own date so the split counts everything before it.
    const inputs = await loadPlanInputs(db, shift.shift_date, shift.shift_date);
    if (inputs instanceof Response) return inputs;
    const shifts = inputs.shifts.map((s) => (s.id === id ? { ...s, on_call_manual: false } : s));
    const change = planOnCall({ ...inputs, shifts, fromDate: shift.shift_date }).find(
      (c) => c.shiftId === id
    );
    fields = {
      on_call_staff_id: change ? change.to : shift.on_call_staff_id,
      on_call_manual: false,
    };
  } else {
    const staffId = body.staffId as string | null;
    if (staffId !== null) {
      const { data: person, error } = await db
        .from('staff')
        .select('id, active, on_call_eligible')
        .eq('id', staffId)
        .maybeSingle();
      if (error) return dbError(error);
      if (!person?.active || !person.on_call_eligible) {
        return json({ error: 'That person is not set up to be on call' }, 400);
      }
    }
    fields = { on_call_staff_id: staffId, on_call_manual: true };
  }

  const { data, error } = await db.from('shifts').update(fields).eq('id', id).select('*').single();
  if (error) return dbError(error);
  const updated = data as ShiftRow;

  if (
    updated.on_call_staff_id !== shift.on_call_staff_id ||
    updated.on_call_manual !== shift.on_call_manual
  ) {
    const nameOf = async (staffId: string | null) => {
      if (!staffId) return 'nobody';
      const { data: row } = await db
        .from('staff')
        .select('display_name')
        .eq('id', staffId)
        .maybeSingle();
      return (row?.display_name as string | undefined) ?? 'Unknown staff';
    };
    const [from, to] = await Promise.all([
      nameOf(shift.on_call_staff_id),
      nameOf(updated.on_call_staff_id),
    ]);
    await logScheduleChange(db, {
      actor: actorFromGate(gate),
      entityType: 'shift',
      entityId: id,
      action: 'update',
      summary: auto
        ? `On-call for shift ${describeShift(updated)} back to the rule: ${to}`
        : `On-call for shift ${describeShift(updated)} set by hand: ${from} → ${to}`,
      details: {
        before: { on_call_staff_id: shift.on_call_staff_id, on_call_manual: shift.on_call_manual },
        after: fields,
      },
    });
  }

  return json({ shift: updated });
};
