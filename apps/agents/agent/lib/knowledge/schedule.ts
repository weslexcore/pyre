// The staff schedule as a knowledge source: shifts in a date window with the
// crew on each, the asker's own shifts and hours, their pending shift
// requests, and open sub requests. Gated by the /admin/schedule page grant
// exactly as the board is, and shaped to what the board shows an employee:
// every shift and everyone's names, but never emails, pay, or other people's
// requests. The asker is the staff row whose email matches the scope's.
//
// Times are Eastern wall-clock strings straight from the tables (shifts are
// never stored in UTC); dates are YYYY-MM-DD. Pure shaping is split from the
// reads so tests/schedule.test.ts can pin it down without a database.

import {
  addDays,
  assignmentHours,
  DOW_LABELS,
  type ShiftAssignmentRow,
  type ShiftRequestRow,
  type ShiftRow,
  type SubRequestRow,
  utcToEastern,
  weekStartOf,
} from '@pyre/schedule-core';
import { getDb } from '../db';
import type { KnowledgeScope } from '../role';
import { scheduleUrl } from './urls';

/** How many days a window covers when the caller gives one edge or none. */
export const DEFAULT_WINDOW_DAYS = 28;
/** The widest window one call may read. */
export const MAX_WINDOW_DAYS = 366;
export const DEFAULT_SHIFT_LIMIT = 50;
export const MAX_SHIFT_LIMIT = 200;

export interface ShiftsInput {
  from?: string;
  to?: string;
  who?: 'me' | 'everyone';
  limit?: number;
}

/** The roster fields the tool needs; the email is for matching the asker and never leaves. */
export interface RosterRow {
  id: string;
  display_name: string;
  email: string | null;
  is_founder: boolean;
  is_shift_lead: boolean;
  active: boolean;
}

/**
 * The date window to read. With neither edge, the next four weeks from
 * today; with one edge, four weeks from (or up to) it; a reversed window is
 * put the right way round; anything wider than a year is cut at the far end.
 */
export function resolveWindow(
  input: Pick<ShiftsInput, 'from' | 'to'>,
  today: string
): { from: string; to: string } {
  let from = input.from ?? null;
  let to = input.to ?? null;
  if (!from && !to) {
    from = today;
    to = addDays(today, DEFAULT_WINDOW_DAYS - 1);
  } else if (from && !to) {
    to = addDays(from, DEFAULT_WINDOW_DAYS - 1);
  } else if (!from && to) {
    from = addDays(to, -(DEFAULT_WINDOW_DAYS - 1));
  }
  if ((from as string) > (to as string)) [from, to] = [to, from];
  const maxTo = addDays(from as string, MAX_WINDOW_DAYS - 1);
  if ((to as string) > maxTo) to = maxTo;
  return { from: from as string, to: to as string };
}

/** Mon/Tue/... for a YYYY-MM-DD date. */
export function weekdayOf(date: string): string {
  return DOW_LABELS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

/** HH:MM:SS → HH:MM. */
function clock(time: string): string {
  return time.slice(0, 5);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** The staff row whose email matches the asker's, if any. */
export function findSelf(staff: RosterRow[], email: string): RosterRow | null {
  if (!email) return null;
  return staff.find((s) => (s.email ?? '').toLowerCase() === email) ?? null;
}

export interface ShapedShift {
  shiftId: string;
  date: string;
  weekday: string;
  label: string;
  startsAt: string;
  endsAt: string;
  status: ShiftRow['status'];
  staffNeeded: number;
  /** Spots still unfilled (staffNeeded minus the crew), never negative. */
  openSpots: number;
  notes: string | null;
  url: string;
  crew: Array<{
    name: string;
    role: ShiftAssignmentRow['role'];
    startsAt: string;
    endsAt: string;
    hours: number;
    isMe: boolean;
  }>;
  /** The asker's own hours on this shift; 0 when they are not on it. */
  myHours: number;
}

/**
 * Shifts with their crew, in date order. `selfId` marks the asker's own
 * assignments. Draft rows are expected to be filtered out already.
 */
export function shapeShifts(
  shifts: ShiftRow[],
  assignments: ShiftAssignmentRow[],
  staff: RosterRow[],
  selfId: string | null
): ShapedShift[] {
  const nameOf = new Map(staff.map((s) => [s.id, s.display_name]));
  const byShift = new Map<string, ShiftAssignmentRow[]>();
  for (const a of assignments) {
    const list = byShift.get(a.shift_id) ?? [];
    list.push(a);
    byShift.set(a.shift_id, list);
  }
  return [...shifts]
    .sort((a, b) =>
      a.shift_date === b.shift_date
        ? a.starts_at.localeCompare(b.starts_at)
        : a.shift_date.localeCompare(b.shift_date)
    )
    .map((shift) => {
      const crew = (byShift.get(shift.id) ?? [])
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .map((a) => ({
          name: nameOf.get(a.staff_id) ?? 'Unknown',
          role: a.role,
          startsAt: clock(a.starts_at),
          endsAt: clock(a.ends_at),
          hours: round1(assignmentHours(a.starts_at, a.ends_at)),
          isMe: selfId !== null && a.staff_id === selfId,
        }));
      return {
        shiftId: shift.id,
        date: shift.shift_date,
        weekday: weekdayOf(shift.shift_date),
        label: shift.label,
        startsAt: clock(shift.starts_at),
        endsAt: clock(shift.ends_at),
        status: shift.status,
        staffNeeded: shift.staff_needed,
        openSpots: Math.max(0, shift.staff_needed - crew.length),
        notes: shift.notes,
        url: scheduleUrl(shift.shift_date),
        crew,
        myHours: round1(crew.filter((c) => c.isMe).reduce((sum, c) => sum + c.hours, 0)),
      };
    });
}

/** The asker's hours across the shaped shifts, in total and by Monday week. */
export function myHoursByWeek(shifts: ShapedShift[]): {
  total: number;
  byWeek: Array<{ weekStart: string; hours: number; shifts: number }>;
} {
  const weeks = new Map<string, { hours: number; shifts: number }>();
  let total = 0;
  for (const shift of shifts) {
    if (shift.myHours <= 0 || shift.status !== 'active') continue;
    total += shift.myHours;
    const key = weekStartOf(shift.date);
    const week = weeks.get(key) ?? { hours: 0, shifts: 0 };
    week.hours += shift.myHours;
    week.shifts += 1;
    weeks.set(key, week);
  }
  return {
    total: round1(total),
    byWeek: [...weeks.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, w]) => ({ weekStart, hours: round1(w.hours), shifts: w.shifts })),
  };
}

/**
 * Shifts in a date window with the crew on each, plus the asker's hours,
 * their pending shift requests, and open sub requests. `who: 'me'` (the
 * default) keeps only the shifts the asker is assigned to; 'everyone' is the
 * whole board.
 */
export async function getShifts(scope: KnowledgeScope, input: ShiftsInput) {
  if (!scope.schedule) {
    return {
      available: false as const,
      error:
        'This staff member does not hold the Schedule page, so the staff schedule is not available to them.',
    };
  }
  const today = utcToEastern(new Date().toISOString()).date;
  const window = resolveWindow(input, today);
  const who = input.who ?? 'me';
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_SHIFT_LIMIT, 1), MAX_SHIFT_LIMIT);
  const db = getDb();

  const [staffRes, shiftsRes] = await Promise.all([
    db.from('staff').select('id, display_name, email, is_founder, is_shift_lead, active'),
    db
      .from('shifts')
      .select('*')
      .gte('shift_date', window.from)
      .lte('shift_date', window.to)
      .eq('is_draft', false)
      .order('shift_date')
      .order('starts_at'),
  ]);
  if (staffRes.error) throw new Error(staffRes.error.message);
  if (shiftsRes.error) throw new Error(shiftsRes.error.message);

  const staff = (staffRes.data ?? []) as RosterRow[];
  const self = findSelf(staff, scope.email);
  const shifts = (shiftsRes.data ?? []) as ShiftRow[];
  const shiftIds = shifts.map((s) => s.id);

  if (who === 'me' && !self) {
    return {
      available: true as const,
      today,
      window,
      self: null,
      error:
        'No staff record matches this staff member\'s login email, so their own shifts cannot be found. The whole board is still readable with who: "everyone".',
    };
  }

  let assignments: ShiftAssignmentRow[] = [];
  let myRequests: ShiftRequestRow[] = [];
  let subRequests: SubRequestRow[] = [];
  if (shiftIds.length > 0) {
    const [assignmentsRes, requestsRes, subsRes] = await Promise.all([
      db.from('shift_assignments').select('*').in('shift_id', shiftIds).eq('is_draft', false),
      self
        ? db
            .from('shift_requests')
            .select('*')
            .in('shift_id', shiftIds)
            .eq('staff_id', self.id)
            .eq('status', 'pending')
        : Promise.resolve({ data: [], error: null }),
      db.from('sub_requests').select('*').in('shift_id', shiftIds).eq('status', 'open'),
    ]);
    if (assignmentsRes.error) throw new Error(assignmentsRes.error.message);
    if (requestsRes.error) throw new Error(requestsRes.error.message);
    if (subsRes.error) throw new Error(subsRes.error.message);
    assignments = (assignmentsRes.data ?? []) as ShiftAssignmentRow[];
    myRequests = (requestsRes.data ?? []) as ShiftRequestRow[];
    subRequests = (subsRes.data ?? []) as SubRequestRow[];
  }

  const all = shapeShifts(shifts, assignments, staff, self?.id ?? null);
  const selected = who === 'me' ? all.filter((s) => s.myHours > 0) : all;
  const shiftById = new Map(all.map((s) => [s.shiftId, s]));
  const nameOf = new Map(staff.map((s) => [s.id, s.display_name]));

  return {
    available: true as const,
    today,
    window,
    who,
    url: scheduleUrl(window.from),
    self: self
      ? { name: self.display_name, isShiftLead: self.is_shift_lead || self.is_founder, active: self.active }
      : null,
    count: selected.length,
    truncated: selected.length > limit,
    shifts: selected.slice(0, limit),
    // Hours from every shift in the window, not just the page returned.
    myHours: self ? myHoursByWeek(all) : null,
    myPendingRequests: myRequests.map((r) => {
      const shift = shiftById.get(r.shift_id);
      return {
        shiftId: r.shift_id,
        date: shift?.date ?? null,
        weekday: shift ? shift.weekday : null,
        label: shift?.label ?? null,
        role: r.role,
        requestedStartsAt: r.requested_starts_at ? clock(r.requested_starts_at) : null,
        requestedEndsAt: r.requested_ends_at ? clock(r.requested_ends_at) : null,
        note: r.note,
        requestedAt: r.created_at,
      };
    }),
    // Open subs are visible to every teammate, since anyone may claim one.
    openSubRequests: subRequests.map((r) => {
      const shift = shiftById.get(r.shift_id);
      return {
        shiftId: r.shift_id,
        date: shift?.date ?? null,
        weekday: shift ? shift.weekday : null,
        label: shift?.label ?? null,
        requestedBy: nameOf.get(r.requester_staff_id) ?? 'Unknown',
        isMine: self !== null && r.requester_staff_id === self.id,
        role: r.role,
        startsAt: clock(r.starts_at),
        endsAt: clock(r.ends_at),
        url: shift?.url ?? scheduleUrl(),
      };
    }),
  };
}
