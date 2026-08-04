// Read side of the staff scheduling admin pages: one GET returns everything
// the islands need for a date range — the roster, shifts with their
// assignments, and every time_off row (tiny table; recurring rules apply to
// any range, so filtering server-side buys nothing). Availability and
// conflicts are computed locally by the islands via lib/schedule.

import type { APIRoute } from 'astro';
import { requireStaff } from '@/lib/auth/admin';
import {
  getDb,
  type ScheduleStaffRow,
  type ShiftAssignmentRow,
  type ShiftRow,
  type TimeOffRow,
} from '@/lib/db';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ScheduleBoardPayload {
  staff: ScheduleStaffRow[];
  shifts: Array<ShiftRow & { assignments: ShiftAssignmentRow[] }>;
  timeOff: TimeOffRow[];
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requireStaff(cookies);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  if (!start || !DATE_RE.test(start) || !end || !DATE_RE.test(end) || end < start) {
    return json({ error: 'start and end must be YYYY-MM-DD with end >= start' }, 400);
  }

  const [staffRes, shiftsRes, timeOffRes] = await Promise.all([
    db.from('schedule_staff').select('*').order('display_name'),
    db
      .from('shifts')
      .select('*')
      .gte('shift_date', start)
      .lte('shift_date', end)
      .order('shift_date')
      .order('starts_at'),
    db.from('time_off').select('*').order('created_at'),
  ]);
  const firstError = staffRes.error ?? shiftsRes.error ?? timeOffRes.error;
  if (firstError) return json({ error: firstError.message }, 500);

  const shifts = (shiftsRes.data ?? []) as Array<ShiftRow & { assignments: ShiftAssignmentRow[] }>;
  for (const shift of shifts) shift.assignments = [];

  if (shifts.length > 0) {
    const { data: assignments, error } = await db
      .from('shift_assignments')
      .select('*')
      .in(
        'shift_id',
        shifts.map((s) => s.id)
      )
      .order('starts_at');
    if (error) return json({ error: error.message }, 500);

    const byShift = new Map(shifts.map((s) => [s.id, s]));
    for (const assignment of (assignments ?? []) as ShiftAssignmentRow[]) {
      byShift.get(assignment.shift_id)?.assignments.push(assignment);
    }
  }

  const payload: ScheduleBoardPayload = {
    staff: (staffRes.data ?? []) as ScheduleStaffRow[],
    shifts,
    timeOff: (timeOffRes.data ?? []) as TimeOffRow[],
  };
  return json(payload);
};
