// Turning schedule rows into calendar events, for both the subscribed .ics
// feed (/api/schedule/feed.ics) and the single-shift download behind the
// board's "Add to calendar" button. Pure — the endpoints do the fetching and
// the gating, this decides only what an event says.
//
// Times come straight off the rows as ET wall clock; generateIcsCalendar names
// that clock with TZID rather than converting to an instant.

import { formatDuties } from '@pyre/schedule-core';
import type { LocalCalendarEvent } from '@/lib/calendar/ics';
import { VENUE_ADDRESS } from '@/lib/calendar/links';
import type { ShiftAssignmentRow, ShiftRow, StaffRow } from '@/lib/db';
import { formatWindowLabel } from '@/lib/schedule/sub';

export type ShiftWithAssignments = ShiftRow & { assignments: ShiftAssignmentRow[] };

/** Suffix marking a partial-window role, so a Setup block reads as one. */
const ROLE_SUFFIX: Record<ShiftAssignmentRow['role'], string> = {
  full: '',
  setup: ' (Setup)',
  partial: ' (Partial)',
};

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

/**
 * One event per shift the person is assigned to. Keyed on the assignment id:
 * a sub claim deletes the requester's row and inserts the claimer's, so the
 * event correctly disappears from one calendar and appears in the other.
 */
export function buildPersonalEvents(args: {
  staffId: string;
  shifts: ShiftWithAssignments[];
  staffById: Map<string, StaffRow>;
  origin: string;
}): LocalCalendarEvent[] {
  const { staffId, shifts, staffById, origin } = args;
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
      // The assignment's own window, not the shift's — a Setup role is short.
      startTime: mine.starts_at,
      endTime: mine.ends_at,
      summary: `Pyre — ${shift.label}${ROLE_SUFFIX[mine.role]}`,
      location: VENUE_ADDRESS,
      description: describe([
        `${shift.label}, ${formatWindowLabel(mine)}`,
        // Duties travel with the event so the phone shows what the shift is,
        // not only when it is.
        formatDuties(mine.duties) && `Duties: ${formatDuties(mine.duties)}`,
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
      lastModified: mine.updated_at,
    });
  }

  return events;
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

  return events;
}

/** Join the non-empty description lines (escaping happens in the generator). */
function describe(parts: Array<string | null>): string {
  return parts.filter((p): p is string => Boolean(p)).join('\n');
}
