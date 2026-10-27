// "Who needs checking on?" — the data behind /admin/guests/floor.
//
// Momence knows who is booked and whether they were checked in, but not when.
// The floor page checks guests in through Momence and keeps the time in
// guest_floor_checkins; this module joins the two. A booking Momence says is
// checked in but we have no time for (checked in at the desk in Momence) gets
// an estimate — the later of the session start and when the booking was made,
// since a walk-in is booked as they arrive — flagged so the page can say so
// and staff can correct it.
//
// The types and the timing math live in floor-timing.ts, which the island
// imports too. Server-only.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GuestFloorCheckinRow } from '@/lib/db';
import {
  bookingMember,
  fetchHostSessions,
  fetchSessionBookings,
  type HostSession,
  type SessionBooking,
} from '@/lib/momence/host-api';
import {
  type Floor,
  type FloorGuest,
  type FloorSession,
  LOOKAHEAD_MINUTES,
  LOOKBACK_MINUTES,
  MINUTE_MS,
} from './floor-timing';

export type { Floor, FloorGuest, FloorSession } from './floor-timing';

/** Who a check-in recorded from Momence's webhook is attributed to. */
export const MOMENCE_ACTOR = 'momence';

function sessionMinutes(session: Pick<HostSession, 'startsAt' | 'endsAt'>): number {
  const ms = Date.parse(session.endsAt) - Date.parse(session.startsAt);
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / MINUTE_MS) : 60;
}

/** Sessions whose guests could be on the floor at `nowMs`, earliest first. */
export function floorSessions(sessions: HostSession[], nowMs: number): FloorSession[] {
  const earliest = nowMs - LOOKBACK_MINUTES * MINUTE_MS;
  const latest = nowMs + LOOKAHEAD_MINUTES * MINUTE_MS;
  return sessions
    .filter((s) => {
      const start = Date.parse(s.startsAt);
      return start >= earliest && start <= latest;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map((s) => ({
      id: String(s.id),
      name: s.name,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      minutes: sessionMinutes(s),
    }));
}

/**
 * When a guest checked in at the desk most likely did: the session start, or
 * when they booked if that was later (a walk-in booked on arrival).
 */
export function estimateCheckIn(sessionStart: string, bookedAt: string | undefined): string {
  const start = Date.parse(sessionStart);
  const booked = bookedAt ? Date.parse(bookedAt) : Number.NaN;
  return new Date(Number.isFinite(booked) && booked > start ? booked : start).toISOString();
}

/** One session's live bookings joined with our recorded check-ins. */
export function floorGuests(
  session: FloorSession,
  bookings: SessionBooking[],
  rows: Map<string, GuestFloorCheckinRow>
): FloorGuest[] {
  const guests: FloorGuest[] = [];
  for (const booking of bookings) {
    if (booking.cancelledAt) continue;
    const bookingId = String(booking.id);
    const person = bookingMember(booking);
    // A time Momence sent us stands only while Momence still has them
    // checked in, so un-checking someone there takes them off the floor. One
    // recorded or corrected here stands on its own.
    const stored = rows.get(bookingId) ?? null;
    const row =
      stored && (stored.updated_by !== MOMENCE_ACTOR || booking.checkedIn) ? stored : null;
    const checkedIn = booking.checkedIn || row !== null;
    const checkedInAt = row
      ? row.checked_in_at
      : booking.checkedIn
        ? estimateCheckIn(session.startsAt, booking.createdAt)
        : null;
    guests.push({
      bookingId,
      sessionId: session.id,
      memberId: person?.memberId ?? '',
      name: person?.name || person?.email || 'Guest',
      seats: Math.max(1, booking.ticketsBought || 1),
      checkedIn,
      checkedInAt,
      estimated: !row && booking.checkedIn,
      minutes: row?.session_minutes ?? session.minutes,
      customMinutes: row?.session_minutes != null,
      checkpointsDone: row?.checkpoints_done ?? {},
    });
  }
  return guests;
}

/**
 * The sessions in the floor window, asked of Momence each time. Not the
 * schedule feed: that is cached for five minutes, so a session added or moved
 * at the desk would be missing from the floor for up to that long. The window
 * is a single small page, and crossing midnight needs no special case.
 */
export async function loadFloorSessions(nowMs: number): Promise<FloorSession[]> {
  const sessions = await fetchHostSessions({
    startAfter: new Date(nowMs - LOOKBACK_MINUTES * MINUTE_MS).toISOString(),
    startBefore: new Date(nowMs + LOOKAHEAD_MINUTES * MINUTE_MS).toISOString(),
  });
  return floorSessions(sessions, nowMs);
}

/** Everyone booked into the window's sessions, with their check-in times. */
export async function loadFloor(db: SupabaseClient, nowMs: number): Promise<Floor> {
  const sessions = await loadFloorSessions(nowMs);
  if (sessions.length === 0) return { sessions, guests: [], complete: true };

  const [bookingResults, rowsResult] = await Promise.all([
    Promise.allSettled(sessions.map((s) => fetchSessionBookings(Number(s.id)))),
    db
      .from('guest_floor_checkins')
      .select('*')
      .in(
        'session_id',
        sessions.map((s) => s.id)
      ),
  ]);
  if (rowsResult.error) throw new Error(rowsResult.error.message);

  const rows = new Map(
    ((rowsResult.data ?? []) as GuestFloorCheckinRow[]).map((r) => [r.booking_id, r])
  );

  let complete = true;
  const guests: FloorGuest[] = [];
  bookingResults.forEach((result, i) => {
    if (result.status === 'rejected') {
      complete = false;
      console.error(
        `[guests/floor] bookings for session ${sessions[i].id} failed:`,
        result.reason instanceof Error ? result.reason.message : result.reason
      );
      return;
    }
    guests.push(...floorGuests(sessions[i], result.value, rows));
  });

  return { sessions, guests, complete };
}

/**
 * The booking a floor mutation names, checked against Momence: it must be a
 * live booking on a session in today's window. Null when it isn't.
 */
export async function findFloorBooking(
  sessionId: string,
  bookingId: string,
  nowMs: number
): Promise<{ session: FloorSession; booking: SessionBooking } | null> {
  const sessions = await loadFloorSessions(nowMs);
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  const bookings = await fetchSessionBookings(Number(sessionId));
  const booking = bookings.find((b) => String(b.id) === bookingId && !b.cancelledAt);
  return booking ? { session, booking } : null;
}

/**
 * A check-in Momence told us about (the session-booking-checked-in webhook),
 * kept as the guest's time unless the floor has its own: a check-in made
 * there, or a time someone corrected there, wins.
 *
 * Momence sends nothing when a guest is un-checked, so a time it sent earlier
 * can be left over from a check-in that was undone. A later check-in of the
 * same booking replaces it and clears the check-ins marked done against the
 * old one. A retried or out-of-order delivery (same or earlier time) changes
 * nothing. Returns whether a row was written.
 */
export async function recordMomenceCheckIn(
  db: SupabaseClient,
  checkIn: { bookingId: string; sessionId: string; memberId: string; checkedInAt: string }
): Promise<boolean> {
  const fields = {
    session_id: checkIn.sessionId,
    member_id: checkIn.memberId || null,
    checked_in_at: checkIn.checkedInAt,
    checkpoints_done: {},
    updated_by: MOMENCE_ACTOR,
  };

  const inserted = await db
    .from('guest_floor_checkins')
    .upsert(
      { booking_id: checkIn.bookingId, ...fields },
      { onConflict: 'booking_id', ignoreDuplicates: true }
    )
    .select('booking_id');
  if (inserted.error) throw new Error(inserted.error.message);
  if ((inserted.data ?? []).length > 0) return true;

  const replaced = await db
    .from('guest_floor_checkins')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('booking_id', checkIn.bookingId)
    .eq('updated_by', MOMENCE_ACTOR)
    .lt('checked_in_at', checkIn.checkedInAt)
    .select('booking_id');
  if (replaced.error) throw new Error(replaced.error.message);
  return (replaced.data ?? []).length > 0;
}
