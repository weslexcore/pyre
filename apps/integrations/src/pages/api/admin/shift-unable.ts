// "Unable to work": an employee pulls themselves off a shift they're assigned
// to. One POST removes the assignment, logs the date (with the assignment's
// hours) as time off, and emails every admin so cover can be arranged.
// Gated by the admin 'unable_to_work' toggle (lib/schedule/settings.ts).
//
// Managers/admins don't need this route — they remove assignments and enter
// time off directly — but it accepts them for their OWN assignments too, so
// the button can behave the same for everyone.

import { timeToMinutes, utcToEastern } from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { APIRoute } from 'astro';
import { type AdminGate, assertSameOrigin, requirePage } from '@/lib/auth/admin';
import { getDb, type ShiftAssignmentRow, type StaffRow, type TimeOffRow } from '@/lib/db';
import { sendTemplate } from '@/lib/email/send';
import {
  actorFromGate,
  describeShift,
  logScheduleChange,
  timeWindow,
} from '@/lib/schedule/change-log';
import { getScheduleSettings } from '@/lib/schedule/settings';

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

/** "Thursday, August 14" from YYYY-MM-DD (dates are already ET wall-clock). */
const formatDateLabel = (date: string): string =>
  new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

/** "2:30p" from HH:MM[:SS], matching the boards' compact time style. */
const formatTime = (t: string): string => {
  const min = timeToMinutes(t);
  const h = Math.floor(min / 60);
  const m = min % 60;
  const suffix = h < 12 ? 'a' : 'p';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, '0')}${suffix}`;
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, '/admin/schedule');
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const settings = await getScheduleSettings();
  if (!settings.unableToWorkEnabled) {
    return json({ error: 'This action is currently turned off — talk to an admin' }, 403);
  }

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

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
  if (shift.shift_date < utcToEastern(new Date().toISOString()).date) {
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

  // 1. Off the shift.
  const { error: deleteError } = await db
    .from('shift_assignments')
    .delete()
    .eq('id', assignment.id);
  if (deleteError) return json({ error: deleteError.message }, 500);

  await logScheduleChange(db, {
    actor,
    entityType: 'assignment',
    entityId: assignment.id,
    action: 'delete',
    summary: `${self.display_name} marked themselves unable to work ${shiftDesc} — removed from the shift`,
    details: { before: assignment },
  });

  // 2. Onto the time-off list, scoped to the hours they were assigned so the
  // rest of the day still reads as available.
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
      note: `Unable to work '${shift.label}'`,
      created_by: 'staff',
    })
    .select('*')
    .single();
  // The assignment is already gone at this point; report the failure rather
  // than pretending the whole action failed.
  if (timeOffError) {
    return json(
      { error: `Removed from the shift, but recording time off failed: ${timeOffError.message}` },
      500
    );
  }
  const timeOff = timeOffRow as TimeOffRow;

  await logScheduleChange(db, {
    actor,
    entityType: 'time_off',
    entityId: timeOff.id,
    action: 'create',
    summary: `Added time off for ${self.display_name} — unable to work ${shiftDesc} (${timeWindow(assignment)})`,
    details: { after: timeOff },
  });

  // 3. Tell the admins. Best-effort per recipient (mirrors the partner
  // verification fan-out): one failed inbox must not fail the others, and the
  // schedule change above must stand regardless.
  const { data: staffRows } = await db.from('staff').select('*');
  const admins = ((staffRows ?? []) as StaffRow[]).filter((s) => s.is_admin && s.email);
  const props = {
    staffName: self.display_name,
    shiftLabel: shift.label,
    dateLabel: formatDateLabel(shift.shift_date),
    timeLabel: `${formatTime(assignment.starts_at)}–${formatTime(assignment.ends_at)}`,
    scheduleUrl: `${new URL(request.url).origin}/admin/schedule`,
  };
  let notified = 0;
  for (const admin of admins) {
    try {
      const result = await sendTemplate({
        to: admin.email as string,
        template: 'shift-unable-notice',
        props,
        kind: 'transactional',
      });
      if (result.status === 'sent') notified += 1;
    } catch (e) {
      console.error(
        `[shift-unable] notify ${admin.email} failed:`,
        e instanceof Error ? e.message : e
      );
    }
  }

  return json({ ok: true, timeOff, notified });
};
