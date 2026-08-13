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
  type ShiftAssignmentRow,
  type ShiftRequestRow,
  type ShiftRow,
  type StaffRow,
  type SubRequestRow,
  type TimeOffRow,
} from '@/lib/db';
import { getScheduleSettings, type ScheduleSettings } from '@/lib/schedule/settings';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ScheduleBoardPayload {
  staff: StaffRow[];
  shifts: Array<ShiftRow & { assignments: ShiftAssignmentRow[] }>;
  timeOff: TimeOffRow[];
  /** Open draft proposals covering the range; only with includeDrafts=1, manage-side only. */
  proposals?: ScheduleProposalRow[];
  /** Whether the caller holds schedule:manage (or is an admin). */
  canManage: boolean;
  /** Whether the caller is an admin — gates the hours report's cost column. */
  isAdmin: boolean;
  /** The staff row matching the caller's login email, if any. */
  selfStaffId: string | null;
  /**
   * Pending shift requests for the fetched shifts: all of them on the manage
   * side, only the caller's own otherwise.
   */
  shiftRequests: ShiftRequestRow[];
  /**
   * Open sub requests for the fetched shifts — everyone sees these, so any
   * teammate can take the shift from the board.
   */
  subRequests: SubRequestRow[];
  /** The admin toggles for the employee-facing actions. */
  settings: ScheduleSettings;
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
    db.from('staff').select('*').order('display_name'),
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
  const staff = (staffRes.data ?? []) as StaffRow[];
  const selfStaffId = email
    ? (staff.find((s) => (s.email ?? '').toLowerCase() === email)?.id ?? null)
    : null;

  // Pending requests on the fetched shifts. Everyone sees enough to render
  // their own "requested" state; only the manage side sees other people's.
  let shiftRequests: ShiftRequestRow[] = [];
  if (shifts.length > 0 && (canManage || selfStaffId)) {
    let requestsQuery = db
      .from('shift_requests')
      .select('*')
      .eq('status', 'pending')
      .in(
        'shift_id',
        shifts.map((s) => s.id)
      )
      .order('created_at');
    if (!canManage) requestsQuery = requestsQuery.eq('staff_id', selfStaffId as string);

    const { data: requests, error } = await requestsQuery;
    if (error) return json({ error: error.message }, 500);
    shiftRequests = (requests ?? []) as ShiftRequestRow[];
  }

  let subRequests: SubRequestRow[] = [];
  if (shifts.length > 0) {
    const { data: subs, error } = await db
      .from('sub_requests')
      .select('*')
      .eq('status', 'open')
      .in(
        'shift_id',
        shifts.map((s) => s.id)
      )
      .order('created_at');
    if (error) return json({ error: error.message }, 500);
    subRequests = (subs ?? []) as SubRequestRow[];
  }

  const payload: ScheduleBoardPayload = {
    // Employees only need names for the board — emails and everyone's
    // dashboard access stay on the manage side.
    staff: canManage
      ? staff
      : staff.map((s) => ({
          ...s,
          email: null,
          pages: [],
          momence_member_id: null,
          added_by: null,
        })),
    shifts,
    timeOff: (timeOffRes.data ?? []) as TimeOffRow[],
    canManage,
    isAdmin: gate.access.isAdmin,
    selfStaffId,
    shiftRequests,
    subRequests,
    settings: await getScheduleSettings(),
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
