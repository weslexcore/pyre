// One shift into the caller's calendar, behind the board's "Add to calendar"
// button. `to` picks the destination: google and outlook redirect to that
// provider's compose URL, ics downloads a file (Apple Calendar, desktop
// Outlook, Thunderbird).
//
// All three are one server route so the board island stays a few plain links —
// no ICS generation, no timezone math, and no node:crypto in the browser
// bundle. Cookie-gated: the browser is already signed in when it follows the
// link, so this needs no new credential.
//
// Unlike the subscribed feed this is a snapshot — it lands in the calendar now
// and won't follow later edits. That's the point: it's the fast path when a
// shift changes and you don't want to wait for Google to re-poll.

import { easternToUtc } from '@pyre/schedule-core';
import type { APIRoute } from 'astro';
import { requirePage } from '@/lib/auth/admin';
import { generateIcsCalendar } from '@/lib/calendar/ics';
import { providerCalendarLinks, VENUE_ADDRESS } from '@/lib/calendar/links';
import { getDb, type ShiftAssignmentRow, type StaffRow } from '@/lib/db';
import { buildPersonalEvents, type ShiftWithAssignments } from '@/lib/schedule/calendar-feed';

export const prerender = false;

const TARGETS = ['google', 'outlook', 'ics'] as const;
type Target = (typeof TARGETS)[number];

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export const GET: APIRoute = async ({ cookies, request, url }) => {
  const gate = await requirePage(cookies, '/admin/schedule');
  if (gate instanceof Response) return gate;

  const shiftId = url.searchParams.get('shift');
  if (!shiftId) return text('Missing shift.', 400);

  const target = (url.searchParams.get('to') ?? 'ics') as Target;
  if (!TARGETS.includes(target)) return text('Unknown calendar target.', 400);

  const db = getDb();
  if (!db) return text('Storage unavailable.', 503);

  const [shiftRes, staffRes] = await Promise.all([
    db.from('shifts').select('*').eq('id', shiftId).maybeSingle(),
    db.from('staff').select('*'),
  ]);
  if (shiftRes.error || staffRes.error) return text('Storage unavailable.', 503);

  const shift = shiftRes.data as ShiftWithAssignments | null;
  if (!shift || shift.is_draft) return text('Shift not found.', 404);

  const { data: assignments, error } = await db
    .from('shift_assignments')
    .select('*')
    .eq('shift_id', shift.id)
    .eq('is_draft', false)
    .order('starts_at');
  if (error) return text('Storage unavailable.', 503);
  shift.assignments = (assignments ?? []) as ShiftAssignmentRow[];

  const allStaff = (staffRes.data ?? []) as StaffRow[];
  const email = (gate.user.email ?? '').toLowerCase();
  const self = allStaff.find((s) => (s.email ?? '').toLowerCase() === email);
  if (!self) return text("Your login isn't linked to the schedule roster.", 403);

  const [event] = buildPersonalEvents({
    staffId: self.id,
    shifts: [shift],
    staffById: new Map(allStaff.map((s) => [s.id, s])),
    origin: new URL(request.url).origin,
  });
  // The button only renders for shifts you're on, so an empty result means the
  // assignment changed between the page load and the click.
  if (!event) return text("You're not on this shift.", 404);

  if (target === 'ics') {
    const ics = generateIcsCalendar({ calendarName: 'Pyre — Shift', events: [event] });
    return new Response(ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="pyre-shift-${shift.shift_date}.ics"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // Google and Outlook want an instant, not a wall clock — this is the one
  // place shift times cross that boundary.
  const links = providerCalendarLinks({
    title: event.summary,
    startIso: easternToUtc(event.date, event.startTime),
    endIso: easternToUtc(event.date, event.endTime),
    location: VENUE_ADDRESS,
    description: event.description,
  });

  return new Response(null, {
    status: 302,
    headers: { Location: links[target], 'Cache-Control': 'no-store' },
  });
};
