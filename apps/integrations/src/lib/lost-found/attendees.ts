// "Who was in the building when this was left?"
//
// This module is the whole unknown-owner half of Lost & Found, and it is the
// one part that depends on data we do not own. Momence is the source of truth
// for who booked what; we ask it for the sessions overlapping the window an
// item was left in, and for the people in those sessions.
//
// A caution worth keeping in view: until this shipped, nothing in the codebase
// had ever read a booking's *identity* — attendance reporting only counts
// seats — so the customer fields on a booking row are newly relied upon.
// `bookingMember()` in lib/momence/host-api.ts tolerates every shape Momence
// has used, and everything here degrades to "no attendees" rather than
// guessing. `identityAvailable` on the result says which happened, so the UI
// can tell staff "Momence returned N bookings but no contact details" instead
// of silently offering an empty list.
//
// A member id with no email is still useful: fetchHostMember fills it in. We
// do that lookup only for the sessions staff actually picked, and cache it per
// request, because it is one HTTP call per person.

import {
  bookingMember,
  fetchHostMember,
  fetchHostSessions,
  fetchSessionBookings,
  type HostSession,
} from '@/lib/momence/host-api';

/** One person we could email about an item. */
export interface Attendee {
  memberId: string;
  name: string;
  email: string;
  /** Whether they actually showed up — a no-show can't have left anything. */
  checkedIn: boolean;
}

export interface SessionAttendees {
  session: SessionSummary;
  attendees: Attendee[];
  /**
   * False when the session had live bookings but none of them carried a
   * customer we could resolve. The difference between "nobody was here" and
   * "we can't see who was here" matters to the person deciding whether to
   * send.
   */
  identityAvailable: boolean;
  /** Live (non-cancelled) bookings, whether or not we could name them. */
  bookingCount: number;
}

export interface SessionSummary {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
}

/**
 * Longest we assume a session can run. Used only to widen the Momence query
 * window backwards, so a class that started before the window but was still
 * running inside it is not missed — `overlaps()` does the real filtering.
 */
const MAX_SESSION_HOURS = 6;
const HOUR_MS = 3_600_000;

function overlaps(session: HostSession, startMs: number, endMs: number): boolean {
  const sessionStart = Date.parse(session.startsAt);
  const sessionEnd = Date.parse(session.endsAt);
  if (Number.isNaN(sessionStart) || Number.isNaN(sessionEnd)) return false;
  return sessionStart <= endMs && sessionEnd >= startMs;
}

function summarize(session: HostSession): SessionSummary {
  return {
    id: String(session.id),
    name: session.name,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
  };
}

/**
 * Sessions that were running at any point inside [start, end]. Momence filters
 * on `startsAt` only, so we ask for a wider slice and narrow it here.
 */
export async function sessionsInWindow(start: string, end: string): Promise<SessionSummary[]> {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return [];

  const sessions = await fetchHostSessions({
    startAfter: new Date(startMs - MAX_SESSION_HOURS * HOUR_MS).toISOString(),
    startBefore: new Date(endMs).toISOString(),
  });

  return sessions
    .filter((s) => overlaps(s, startMs, endMs))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map(summarize);
}

/**
 * The people on one session's booking list, cancelled seats dropped and
 * de-duplicated by email (a member who books two seats is still one person to
 * email). Emails missing from the booking row are filled in from the member
 * record; anyone we still can't reach is left out.
 */
export async function attendeesForSession(
  session: SessionSummary,
  emailCache: Map<string, string> = new Map()
): Promise<SessionAttendees> {
  const bookings = (await fetchSessionBookings(Number(session.id))).filter((b) => !b.cancelledAt);

  const people = bookings
    .map((booking) => ({ booking, person: bookingMember(booking) }))
    .filter(
      (
        row
      ): row is {
        booking: (typeof bookings)[number];
        person: NonNullable<ReturnType<typeof bookingMember>>;
      } => row.person !== null
    );

  const byEmail = new Map<string, Attendee>();
  for (const { booking, person } of people) {
    let email = person.email;
    let name = person.name;

    if (!email && person.memberId) {
      const cached = emailCache.get(person.memberId);
      if (cached !== undefined) {
        email = cached;
      } else {
        try {
          const member = await fetchHostMember(Number(person.memberId));
          email = (member.email ?? '').trim().toLowerCase();
          name = name || [member.firstName, member.lastName].filter(Boolean).join(' ').trim();
          emailCache.set(person.memberId, email);
        } catch (e) {
          console.error(
            `[lost-found] member ${person.memberId} lookup failed:`,
            e instanceof Error ? e.message : e
          );
          emailCache.set(person.memberId, '');
        }
      }
    }

    if (!email) continue;

    // A person booked twice counts once, and counts as attending if any of
    // their seats was checked in.
    const existing = byEmail.get(email);
    if (existing) {
      existing.checkedIn = existing.checkedIn || booking.checkedIn;
      if (!existing.name && name) existing.name = name;
      continue;
    }
    byEmail.set(email, { memberId: person.memberId, name, email, checkedIn: booking.checkedIn });
  }

  return {
    session,
    attendees: [...byEmail.values()],
    identityAvailable: bookings.length === 0 || people.length > 0,
    bookingCount: bookings.length,
  };
}

/**
 * Everything a staff member needs to choose who to email: the sessions
 * overlapping the window, each with its people. One Momence call per session,
 * so the window is bounded upstream by MAX_WINDOW_HOURS.
 */
export async function attendeesInWindow(
  start: string,
  end: string
): Promise<{ sessions: SessionAttendees[]; identityAvailable: boolean }> {
  const sessions = await sessionsInWindow(start, end);
  const emailCache = new Map<string, string>();

  const results: SessionAttendees[] = [];
  for (const session of sessions) {
    results.push(await attendeesForSession(session, emailCache));
  }

  // Only claim a blackout when at least one session actually had bookings —
  // an empty afternoon is not an outage.
  const withBookings = results.filter((r) => r.bookingCount > 0);
  return {
    sessions: results,
    identityAvailable: withBookings.length === 0 || withBookings.some((r) => r.identityAvailable),
  };
}
