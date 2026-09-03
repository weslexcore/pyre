// Per-shift guest signups for the staff schedule: how many people are booked
// into the Momence sessions (and private appointments) that fall inside each
// shift's window. Read-only and best-effort — the board paints without it.
//
// Matching is by time, not by momence_session_ids: manual shifts carry no
// refs, and a session deleted and recreated in Momence gets a new id while
// still sitting in the same window. A session belongs to the shift on its ET
// date whose [starts_at, ends_at) window contains the session's ET start, so
// a session on an AM/PM boundary lands in exactly one shift.

import { addDays, timeToMinutes, utcToEastern } from '@pyre/schedule-core';
import { getRedis } from '@pyre/webhook-core';
import type { ShiftRow } from '@/lib/db';
import {
  type AppointmentReservation,
  fetchAppointmentReservations,
  fetchHostSessions,
  type HostSession,
} from '@/lib/momence/host-api';
import { formatSignups, type ShiftSignups } from '@/lib/schedule/signups-format';

export { formatSignups, type ShiftSignups };

export type SignupShift = Pick<ShiftRow, 'id' | 'shift_date' | 'starts_at' | 'ends_at' | 'status'>;

export interface ScheduleFeed {
  sessions: HostSession[];
  appointments: AppointmentReservation[];
}

/**
 * Sum Momence bookings into the shifts whose window contains each session's
 * ET start. Sessions contribute their live bookingCount (already net of
 * cancellations); each appointment reservation counts as one guest.
 */
export function countSignups(
  shifts: SignupShift[],
  sessions: HostSession[],
  appointments: AppointmentReservation[]
): ShiftSignups {
  const active = shifts.filter((s) => s.status !== 'cancelled');
  const signups: ShiftSignups = {};
  for (const shift of active) signups[shift.id] = 0;

  const byDate = new Map<string, Array<{ id: string; startMin: number; endMin: number }>>();
  for (const shift of active) {
    const list = byDate.get(shift.shift_date) ?? [];
    list.push({
      id: shift.id,
      startMin: timeToMinutes(shift.starts_at),
      endMin: timeToMinutes(shift.ends_at),
    });
    byDate.set(shift.shift_date, list);
  }

  const add = (startsAt: string, guests: number) => {
    if (!startsAt || guests <= 0) return;
    const local = utcToEastern(startsAt);
    const candidates = byDate.get(local.date);
    if (!candidates) return;
    const match = candidates.find((c) => local.minutes >= c.startMin && local.minutes < c.endMin);
    if (match) signups[match.id] += guests;
  };

  for (const session of sessions) add(session.startsAt, session.bookingCount ?? 0);
  for (const appointment of appointments) add(appointment.startsAt, 1);

  return signups;
}

const FEED_CACHE_PREFIX = 'cache:momence:schedule-feed:';
/** Short: the count is a live-ish number staff glance at, not a ledger. */
const FEED_CACHE_TTL_SECONDS = 5 * 60;

// getRedis() warns on every call when the KV env vars are absent, so resolve
// the client once per module rather than per request.
let redisClient: ReturnType<typeof getRedis> | undefined;
function redis(): ReturnType<typeof getRedis> {
  if (redisClient === undefined) redisClient = getRedis();
  return redisClient;
}

/**
 * Momence sessions and appointment reservations covering an inclusive ET
 * date range. Momence filters on UTC instants, so the window is padded a
 * day either side and callers bucket precisely by ET (countSignups does).
 * Cached briefly so the board's polling and repeat visits don't re-hit the
 * host API.
 */
export async function fetchScheduleFeed(start: string, end: string): Promise<ScheduleFeed> {
  const client = redis();
  const cacheKey = `${FEED_CACHE_PREFIX}${start}:${end}`;
  if (client) {
    const cached = await client.get<ScheduleFeed>(cacheKey);
    if (cached) return cached;
  }

  const startAfter = `${addDays(start, -1)}T00:00:00.000Z`;
  const startBefore = `${addDays(end, 2)}T00:00:00.000Z`;
  const [sessions, appointments] = await Promise.all([
    fetchHostSessions({ startAfter, startBefore }),
    fetchAppointmentReservations({ startAfter, startBefore }),
  ]);
  const feed: ScheduleFeed = { sessions, appointments };

  if (client) await client.set(cacheKey, feed, { ex: FEED_CACHE_TTL_SECONDS });
  return feed;
}
