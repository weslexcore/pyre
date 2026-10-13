// Turning schedule rows into calendar events, for both the subscribed .ics
// feed (/api/schedule/feed.ics) and the single-shift download behind the
// board's "Add to calendar" button. Pure — the endpoints do the fetching and
// the gating, this decides only what an event says.
//
// Times come straight off the rows as ET wall clock; generateIcsCalendar names
// that clock with TZID rather than converting to an instant.

import { type DutyCatalog, formatDuties } from '@pyre/schedule-core';
import type { AllDayCalendarEvent, LocalCalendarEvent } from '@/lib/calendar/ics';
import { VENUE_ADDRESS } from '@/lib/calendar/links';
import type { ShiftAssignmentRow, ShiftRow, StaffRow } from '@/lib/db';
import { formatWindowLabel } from '@/lib/schedule/sub';

export type ShiftWithAssignments = ShiftRow & { assignments: ShiftAssignmentRow[] };

/** Deep link back to the shift on the board — same scheme the emails use. */
function boardUrl(origin: string, shift: ShiftRow): string {
  return `${origin}/admin/schedule?view=week&date=${shift.shift_date}&shift=${shift.id}`;
}

/**
 * A cancelled shift keeps its event rather than vanishing: clients that merge
 * a feed instead of replacing it would otherwise leave a stale entry sitting
 * in someone's day.
 */
function statusOf(shift: ShiftRow): LocalCalendarEvent['status'] {
  return shift.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED';
}

function nameOf(staffById: Map<string, StaffRow>, id: string): string {
  return staffById.get(id)?.display_name ?? 'Someone';
}

/** "On call today: Wes" for a shift's description, or null when nobody is. */
function onCallLine(staffById: Map<string, StaffRow>, shift: ShiftRow): string | null {
  return shift.on_call_staff_id
    ? `On call today: ${nameOf(staffById, shift.on_call_staff_id)}`
    : null;
}

/** Deep link to a day on the board. */
function dayUrl(origin: string, date: string): string {
  return `${origin}/admin/schedule?view=week&date=${date}`;
}

/** Non-draft shifts by date, each day in start order. */
function shiftsByDate(shifts: ShiftWithAssignments[]): Map<string, ShiftWithAssignments[]> {
  const byDate = new Map<string, ShiftWithAssignments[]>();
  for (const shift of [...shifts].sort(
    (a, b) => a.shift_date.localeCompare(b.shift_date) || a.starts_at.localeCompare(b.starts_at)
  )) {
    if (shift.is_draft) continue;
    const list = byDate.get(shift.shift_date) ?? [];
    list.push(shift);
    byDate.set(shift.shift_date, list);
  }
  return byDate;
}

/** "Morning 9a–1p: Sunny, Julien" for each shift in a day's on-call event. */
function dayLines(staffById: Map<string, StaffRow>, day: ShiftWithAssignments[]): string[] {
  return day
    .filter((s) => s.status === 'active')
    .map((s) => {
      const crew = s.assignments
        .filter((a) => !a.is_draft)
        .map((a) => nameOf(staffById, a.staff_id));
      return `${s.label} ${formatWindowLabel(s)}: ${crew.length > 0 ? crew.join(', ') : 'nobody assigned yet'}`;
    });
}

/** The latest updated_at among the rows — on-call changes touch every shift that day. */
function latest(rows: Array<{ updated_at: string }>): string | undefined {
  return rows.reduce<string | undefined>(
    (max, r) => (!max || r.updated_at > max ? r.updated_at : max),
    undefined
  );
}

/**
 * One event per shift the person is assigned to. Keyed on the assignment id:
 * a sub claim deletes the requester's row and inserts the claimer's, so the
 * event correctly disappears from one calendar and appears in the other.
 *
 * On-call is held for a whole day, so it is its own all-day event — one per
 * day they're on call, whether or not they work that day — never a timed
 * block. That keeps "working" and "on call" apart at a glance. Keyed on the
 * date: when on-call moves to someone else it leaves this feed and appears
 * in theirs. Shift events come first, so a caller after one shift's event
 * can take the first non-all-day one.
 */
export function buildPersonalEvents(args: {
  staffId: string;
  shifts: ShiftWithAssignments[];
  staffById: Map<string, StaffRow>;
  origin: string;
  /** The duty list (loadDutyCatalog) the event's "Duties:" line is labelled from. */
  dutyCatalog: DutyCatalog;
}): LocalCalendarEvent[] {
  const { staffId, shifts, staffById, origin, dutyCatalog } = args;
  const events: LocalCalendarEvent[] = [];

  for (const shift of shifts) {
    // Drafts are proposals under review, not commitments — never in a feed.
    if (shift.is_draft) continue;
    const mine = shift.assignments.find((a) => a.staff_id === staffId && !a.is_draft);
    if (!mine) continue;

    const coworkers = shift.assignments
      .filter((a) => a.staff_id !== staffId && !a.is_draft)
      .map((a) => nameOf(staffById, a.staff_id));

    events.push({
      uid: `pyre-shift-${mine.id}@pyresauna.com`,
      date: shift.shift_date,
      // The assignment's own hours, not the shift's — people come and go at different times.
      startTime: mine.starts_at,
      endTime: mine.ends_at,
      summary: `Pyre — ${shift.label}`,
      location: VENUE_ADDRESS,
      description: describe([
        `${shift.label}, ${formatWindowLabel(mine)}`,
        shift.on_call_staff_id === staffId ? "You're on call today." : onCallLine(staffById, shift),
        // Duties travel with the event so the phone shows what the shift is,
        // not only when it is.
        formatDuties(dutyCatalog, mine.duties) &&
          `Duties: ${formatDuties(dutyCatalog, mine.duties)}`,
        coworkers.length > 0
          ? `With: ${coworkers.join(', ')}`
          : 'You are on your own for this one.',
        shift.notes ? `Notes: ${shift.notes}` : null,
        mine.notes,
        shift.status === 'cancelled' ? 'This shift was cancelled.' : null,
        boardUrl(origin, shift),
      ]),
      url: boardUrl(origin, shift),
      status: statusOf(shift),
      // The shift row changes when on-call does; the assignment row doesn't.
      lastModified: mine.updated_at > shift.updated_at ? mine.updated_at : shift.updated_at,
    });
  }

  for (const [date, day] of shiftsByDate(shifts)) {
    const held = day.filter((s) => s.on_call_staff_id === staffId);
    if (held.length > 0) events.push(onCallDayEvent(date, day, held, staffById, origin));
  }

  return events;
}

/**
 * The all-day on-call event for one day. `held` is the day's shifts naming
 * this person; if every one of them is cancelled the event is too, so a
 * client that merges rather than replaces doesn't keep a stale day.
 */
function onCallDayEvent(
  date: string,
  day: ShiftWithAssignments[],
  held: ShiftWithAssignments[],
  staffById: Map<string, StaffRow>,
  origin: string
): AllDayCalendarEvent {
  const live = held.some((s) => s.status === 'active');
  return {
    uid: `pyre-oncall-${date}@pyresauna.com`,
    date,
    allDay: true,
    summary: 'Pyre — On call',
    location: VENUE_ADDRESS,
    description: describe([
      "You're on call all day. The crew may reach out with questions.",
      ...dayLines(staffById, day),
      live ? null : "The day's shifts were cancelled.",
      dayUrl(origin, date),
    ]),
    url: dayUrl(origin, date),
    status: live ? 'CONFIRMED' : 'CANCELLED',
    lastModified: latest(day),
  };
}

/**
 * The manage-side feed: every shift, whoever is on it, with the coverage count
 * in the title so an understaffed day is visible from a month view without
 * opening anything.
 */
export function buildTeamEvents(args: {
  shifts: ShiftWithAssignments[];
  staffById: Map<string, StaffRow>;
  origin: string;
}): LocalCalendarEvent[] {
  const { shifts, staffById, origin } = args;
  const events: LocalCalendarEvent[] = [];

  for (const shift of shifts) {
    if (shift.is_draft) continue;
    const assigned = shift.assignments.filter((a) => !a.is_draft);
    const names = assigned.map((a) => nameOf(staffById, a.staff_id));
    const short = shift.status === 'active' && assigned.length < shift.staff_needed;

    events.push({
      uid: `pyre-cover-${shift.id}@pyresauna.com`,
      date: shift.shift_date,
      startTime: shift.starts_at,
      endTime: shift.ends_at,
      summary: `${short ? '⚠ ' : ''}${shift.label} — ${assigned.length}/${shift.staff_needed}`,
      location: VENUE_ADDRESS,
      description: describe([
        `${shift.label}, ${formatWindowLabel(shift)}`,
        names.length > 0 ? `On shift: ${names.join(', ')}` : 'Nobody assigned yet.',
        onCallLine(staffById, shift),
        short ? `Needs ${shift.staff_needed - assigned.length} more.` : null,
        shift.notes ? `Notes: ${shift.notes}` : null,
        shift.status === 'cancelled' ? 'This shift was cancelled.' : null,
        boardUrl(origin, shift),
      ]),
      url: boardUrl(origin, shift),
      status: statusOf(shift),
      lastModified: shift.updated_at,
    });
  }

  // Who's on call each day, as its own all-day event so it reads apart from
  // the shifts in a month view.
  for (const [date, day] of shiftsByDate(shifts)) {
    const live = day.filter((s) => s.status === 'active');
    const holders = [
      ...new Set(live.map((s) => s.on_call_staff_id).filter((id): id is string => !!id)),
    ];
    if (holders.length === 0) continue;
    const names = holders.map((id) => nameOf(staffById, id)).join(' / ');
    events.push({
      uid: `pyre-oncall-day-${date}@pyresauna.com`,
      date,
      allDay: true,
      summary: `On call: ${names}`,
      location: VENUE_ADDRESS,
      description: describe([
        `${names} ${holders.length === 1 ? 'is' : 'are'} on call all day.`,
        ...dayLines(staffById, day),
        dayUrl(origin, date),
      ]),
      url: dayUrl(origin, date),
      status: 'CONFIRMED',
      lastModified: latest(live),
    });
  }

  return events;
}

/** Join the non-empty description lines (escaping happens in the generator). */
function describe(parts: Array<string | null>): string {
  return parts.filter((p): p is string => Boolean(p)).join('\n');
}
