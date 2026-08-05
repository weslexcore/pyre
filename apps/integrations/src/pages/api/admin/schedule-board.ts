// Read side of the staff scheduling admin pages: one GET returns everything
// the islands need for a date range — the roster, shifts with their
// assignments, and every time_off row (tiny table; recurring rules apply to
// any range, so filtering server-side buys nothing). Availability and
// conflicts are computed locally by the islands via lib/schedule.

import type { APIRoute } from 'astro';
import { hasScheduleManage } from '@/components/admin/adminTools';
import { requirePage } from '@/lib/auth/admin';
import {
  getDb,
  type ScheduleProposalRow,
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
  /** Open draft proposals covering the range; only with includeDrafts=1, manage-side only. */
  proposals?: ScheduleProposalRow[];
  /** Whether the caller holds schedule:manage (or is an admin). */
  canManage: boolean;
  /** The schedule_staff row matching the caller's login email, if any. */
  selfStaffId: string | null;
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, '/admin/schedule');
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  if (!start || !DATE_RE.test(start) || !end || !DATE_RE.test(end) || end < start) {
    return json({ error: 'start and end must be YYYY-MM-DD with end >= start' }, 400);
  }

  const canManage = hasScheduleManage(gate.access);

  // Drafts (agent proposals under review) are only returned to the review UI,
  // and only for callers on the manage side.
  const includeDrafts = canManage && url.searchParams.get('includeDrafts') === '1';

  let shiftsQuery = db
    .from('shifts')
    .select('*')
    .gte('shift_date', start)
    .lte('shift_date', end)
    .order('shift_date')
    .order('starts_at');
  if (!includeDrafts) shiftsQuery = shiftsQuery.eq('is_draft', false);

  const [staffRes, shiftsRes, timeOffRes] = await Promise.all([
    db.from('schedule_staff').select('*').order('display_name'),
    shiftsQuery,
    db.from('time_off').select('*').order('created_at'),
  ]);
  const firstError = staffRes.error ?? shiftsRes.error ?? timeOffRes.error;
  if (firstError) return json({ error: firstError.message }, 500);

  const shifts = (shiftsRes.data ?? []) as Array<ShiftRow & { assignments: ShiftAssignmentRow[] }>;
  for (const shift of shifts) shift.assignments = [];

  if (shifts.length > 0) {
    let assignmentsQuery = db
      .from('shift_assignments')
      .select('*')
      .in(
        'shift_id',
        shifts.map((s) => s.id)
      )
      .order('starts_at');
    if (!includeDrafts) assignmentsQuery = assignmentsQuery.eq('is_draft', false);

    const { data: assignments, error } = await assignmentsQuery;
    if (error) return json({ error: error.message }, 500);

    const byShift = new Map(shifts.map((s) => [s.id, s]));
    for (const assignment of (assignments ?? []) as ShiftAssignmentRow[]) {
      byShift.get(assignment.shift_id)?.assignments.push(assignment);
    }
  }

  const email = (gate.user.email ?? '').toLowerCase();
  const staff = (staffRes.data ?? []) as ScheduleStaffRow[];
  const selfStaffId = email
    ? (staff.find((s) => (s.momence_email ?? '').toLowerCase() === email)?.id ?? null)
    : null;

  const payload: ScheduleBoardPayload = {
    // Employees only need names for the board — keep roster emails on the
    // manage side.
    staff: canManage ? staff : staff.map((s) => ({ ...s, momence_email: null })),
    shifts,
    timeOff: (timeOffRes.data ?? []) as TimeOffRow[],
    canManage,
    selfStaffId,
  };

  if (includeDrafts) {
    const { data: proposals, error } = await db
      .from('schedule_proposals')
      .select('*')
      .eq('status', 'draft')
      .gte('week_start', addDaysStr(start, -6))
      .lte('week_start', end)
      .order('created_at', { ascending: false });
    if (error) return json({ error: error.message }, 500);
    payload.proposals = (proposals ?? []) as ScheduleProposalRow[];
  }

  return json(payload);
};

/** start minus N days without pulling in a date lib (weeks overlap ranges). */
function addDaysStr(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
