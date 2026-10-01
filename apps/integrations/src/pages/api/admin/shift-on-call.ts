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

import { planOnCall } from '@pyre/schedule-core';
import type { APIRoute } from 'astro';
import { requireScheduleManage } from '@/lib/auth/admin';
import { getDb, type ShiftRow } from '@/lib/db';
import { dbError, gateMutation, json, readJsonBody } from '@/lib/http/route';
import { actorFromGate, describeShift, logScheduleChange } from '@/lib/schedule/change-log';
import { fillOnCall, loadOnCallInputs } from '@/lib/schedule/on-call';

export const prerender = false;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A month view plus slack; the auto action is never asked for more. */
const MAX_RANGE_DAYS = 45;

function daysBetween(start: string, end: string): number {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000
  );
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

  const { count, error: countError } = await db
    .from('staff')
    .select('id', { count: 'exact', head: true })
    .eq('active', true)
    .eq('on_call_eligible', true);
  if (countError) return dbError(countError);
  if (!count) {
    return json({ error: 'Nobody is set up to be on call — tick "On call" on /admin/users' }, 400);
  }

  // Past shifts are a record of who was on call — fillOnCall starts at today.
  const result = await fillOnCall(db, {
    start,
    end,
    actor: actorFromGate(gate),
    why: 'Auto-filled',
  });
  if ('error' in result) return dbError(result.error);
  return json(result);
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
    const inputs = await loadOnCallInputs(db, shift.shift_date, shift.shift_date);
    if ('error' in inputs) return dbError(inputs.error);
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
