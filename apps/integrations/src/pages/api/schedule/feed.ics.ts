// The subscribable staff shift calendar. An employee pastes this URL into
// Google/Apple/Outlook once and their shifts keep themselves current.
//
// Calendar clients poll with no cookies, so the `t` token — staff.calendar_token,
// rotatable per person from the Subscribe panel — is the entire auth gate.
// scope=team is re-derived from that row's own permissions, never trusted from
// the query string, so an employee's token can't read the whole team's feed.
//
// The window stops at the confirmed horizon: past the Monday-after-next the
// schedule is still a working plan, and shifts that may still move don't
// belong in someone's personal calendar. That plus Google's own polling
// cadence (hours, and it ignores REFRESH-INTERVAL) makes this a background
// convenience — the board's Add-to-calendar button and the shift emails stay
// the fast path for anything time-sensitive.

import { lastConfirmedDate } from '@pyre/schedule-core';
import type { APIRoute } from 'astro';
import { hasScheduleManage } from '@/components/admin/adminTools';
import { generateIcsCalendar } from '@/lib/calendar/ics';
import { getDb, type ShiftAssignmentRow, type StaffRow } from '@/lib/db';
import {
  buildPersonalEvents,
  buildTeamEvents,
  type ShiftWithAssignments,
} from '@/lib/schedule/calendar-feed';
import { todayEastern } from '@/lib/schedule/sub';

export const prerender = false;

/** How much history to carry, so the calendar doubles as a record of hours worked. */
const PAST_DAYS = 60;

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/**
 * Subscribers poll this unattended, so a broken feed is silent unless it says
 * something — nobody is watching a browser tab when it starts failing.
 */
function unavailable(stage: string, error: { message: string }): Response {
  console.error(`[calendar-feed] ${stage} failed:`, error.message);
  return text('Storage unavailable.', 503);
}

/** date minus N days, without pulling in a date lib (matches schedule-board). */
function addDaysStr(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const GET: APIRoute = async ({ request, url }) => {
  const token = url.searchParams.get('t');
  if (!token) return text('Missing token.', 400);

  const db = getDb();
  if (!db) return text('Storage unavailable.', 503);

  const { data: staffRow, error: staffError } = await db
    .from('staff')
    .select('*')
    .eq('calendar_token', token)
    .maybeSingle();
  if (staffError) return unavailable('staff lookup', staffError);

  const person = staffRow as StaffRow | null;
  // Same answer for a bad token and a deactivated person: a departed
  // employee's subscription goes dark without announcing that it existed.
  if (!person?.active) return text('Calendar not found.', 404);

  const wantsTeam = url.searchParams.get('scope') === 'team';
  const canManage = hasScheduleManage({ isAdmin: person.is_admin, pages: person.pages });
  if (wantsTeam && !canManage) return text('Not permitted.', 403);

  const today = todayEastern();
  const start = addDaysStr(today, -PAST_DAYS);
  const end = lastConfirmedDate(today);

  const [shiftsRes, allStaffRes] = await Promise.all([
    db
      .from('shifts')
      .select('*')
      .eq('is_draft', false)
      .gte('shift_date', start)
      .lte('shift_date', end)
      .order('shift_date')
      .order('starts_at'),
    db.from('staff').select('*'),
  ]);
  const loadError = shiftsRes.error ?? allStaffRes.error;
  if (loadError) return unavailable('shift load', loadError);

  const shifts = (shiftsRes.data ?? []) as ShiftWithAssignments[];
  for (const shift of shifts) shift.assignments = [];

  if (shifts.length > 0) {
    const { data: assignments, error } = await db
      .from('shift_assignments')
      .select('*')
      .eq('is_draft', false)
      .in(
        'shift_id',
        shifts.map((s) => s.id)
      )
      .order('starts_at');
    if (error) return unavailable('assignment load', error);

    const byShift = new Map(shifts.map((s) => [s.id, s]));
    for (const assignment of (assignments ?? []) as ShiftAssignmentRow[]) {
      byShift.get(assignment.shift_id)?.assignments.push(assignment);
    }
  }

  const staffById = new Map(((allStaffRes.data ?? []) as StaffRow[]).map((s) => [s.id, s]));
  const origin = new URL(request.url).origin;

  const ics = generateIcsCalendar({
    calendarName: wantsTeam ? 'Pyre — Team Coverage' : 'Pyre — My Shifts',
    events: wantsTeam
      ? buildTeamEvents({ shifts, staffById, origin })
      : buildPersonalEvents({ staffId: person.id, shifts, staffById, origin }),
  });

  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      // No Content-Disposition — that would turn a subscription into a
      // one-time download. `private` keeps someone's schedule off the CDN
      // even though the URL is what authenticates it.
      'Cache-Control': 'private, max-age=300, no-transform',
    },
  });
};
