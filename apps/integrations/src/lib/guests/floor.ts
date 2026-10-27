// "Who needs checking on?" — the data behind Check Ins (/admin/guests/check-ins).
//
// Momence knows who is booked and whether they were checked in, but not when.
// The Check Ins page checks guests in through Momence and keeps the time in
// guest_floor_checkins; this module joins the two. A booking Momence says is
// checked in but we have no time for (checked in at the desk in Momence) gets
// an estimate — the later of the session start and when the booking was made,
// since a walk-in is booked as they arrive — flagged so the page can say so
// and staff can correct it.
//
// A guest changing length mid-visit is cancelled out of their booking in
// Momence and rebooked into the longer or shorter session, so they pay the
// right price. findMoves spots that and carries their arrival time and done
// check-ins over to the new booking, so their clock doesn't restart.
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
  type CheckpointDone,
  type Floor,
  type FloorGuest,
  type FloorMove,
  type FloorSession,
  LOOKAHEAD_MINUTES,
  LOOKBACK_MINUTES,
  MINUTE_MS,
} from './floor-timing';

export type { Floor, FloorGuest, FloorSession } from './floor-timing';

/** Who a check-in recorded from Momence's webhook is attributed to. */
export const MOMENCE_ACTOR = 'momence';
/** Who a check-in carried over from a cancelled booking is attributed to. */
export const MOVE_ACTOR = 'floor-move';

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

/** One booking on one of the window's sessions, cancelled or not. */
export interface FloorSeat {
  session: FloorSession;
  booking: SessionBooking;
}

/** A move findMoves spotted: what the new booking should carry over. */
export interface Move {
  fromBookingId: string;
  fromSessionId: string;
  arrivedAt: string;
  checkpointsDone: Record<string, CheckpointDone>;
}

/** The same guest across bookings: their member id, else their email. */
function guestKey(booking: SessionBooking): string | null {
  const person = bookingMember(booking);
  if (!person) return null;
  return person.memberId ? `m:${person.memberId}` : `e:${person.email}`;
}

/** When a seat's guest arrived, as far as we know: recorded, else Momence's flag. */
function arrivalOf(
  seat: FloorSeat,
  rows: Map<string, GuestFloorCheckinRow>
): { at: string; done: Record<string, CheckpointDone> } | null {
  const row = rows.get(String(seat.booking.id));
  // Checked out means they left; a booking after that is a new visit.
  if (row?.checked_out_at) return null;
  if (row) return { at: row.checked_in_at, done: row.checkpoints_done ?? {} };
  if (seat.booking.checkedIn) {
    return { at: estimateCheckIn(seat.session.startsAt, seat.booking.createdAt), done: {} };
  }
  return null;
}

/** Two sessions running at the same time for some of it (touching isn't). */
function overlaps(a: FloorSession, b: FloorSession): boolean {
  return (
    Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt)
  );
}

const createdMs = (seat: FloorSeat) => Date.parse(seat.booking.createdAt ?? '') || 0;

export interface Moves {
  /** Live bookings that carry a guest over from earlier ones, by booking id. */
  moves: Map<string, Move>;
  /** Live bookings a newer booking for the same guest replaces — not shown. */
  superseded: Set<string>;
}

/**
 * One visit can span several bookings: to change a guest's length, staff
 * cancel their booking and book them into a longer or shorter session (or
 * book first and cancel later). Among one guest's bookings on sessions that
 * overlap in time, the latest-made live booking is theirs; any older live one
 * is superseded. That booking carries over the earliest arrival among the
 * others they had arrived for — cancelled or superseded — and every check-in
 * marked done on them. Only overlapping sessions count, so a separate visit
 * later in the day, or a back-to-back next session, starts its own clock.
 *
 * A booking whose row already records a move is left alone: its carried time
 * is an ordinary row by then, and may have been corrected on the floor.
 */
export function findMoves(seats: FloorSeat[], rows: Map<string, GuestFloorCheckinRow>): Moves {
  const byGuest = new Map<string, FloorSeat[]>();
  for (const seat of seats) {
    const key = guestKey(seat.booking);
    if (!key) continue;
    byGuest.set(key, [...(byGuest.get(key) ?? []), seat]);
  }

  const moves = new Map<string, Move>();
  const superseded = new Set<string>();
  for (const group of byGuest.values()) {
    if (group.length < 2) continue;
    const live = group.filter((s) => !s.booking.cancelledAt);

    for (const seat of live) {
      const bookingId = String(seat.booking.id);
      const newer = live.some(
        (other) =>
          other !== seat &&
          overlaps(other.session, seat.session) &&
          createdMs(other) > createdMs(seat)
      );
      if (newer) {
        superseded.add(bookingId);
        continue;
      }
      if (rows.get(bookingId)?.moved_from_booking_id) continue;

      const earlier = group.flatMap((other) => {
        if (other === seat || !overlaps(other.session, seat.session)) return [];
        const arrival = arrivalOf(other, rows);
        return arrival ? [{ seat: other, arrival }] : [];
      });
      if (earlier.length === 0) continue;

      const first = [...earlier].sort((x, y) => x.arrival.at.localeCompare(y.arrival.at))[0];
      const latest = [...earlier].sort(
        (x, y) =>
          (Date.parse(y.seat.booking.cancelledAt ?? '') || createdMs(y.seat)) -
          (Date.parse(x.seat.booking.cancelledAt ?? '') || createdMs(x.seat))
      )[0];
      moves.set(bookingId, {
        fromBookingId: String(latest.seat.booking.id),
        fromSessionId: latest.seat.session.id,
        arrivedAt: first.arrival.at,
        checkpointsDone: Object.assign({}, ...earlier.map((e) => e.arrival.done)),
      });
    }
  }
  return { moves, superseded };
}

/**
 * The row a checked-in move writes: the new booking, with the arrival time
 * and done check-ins from the old one (and any marked on this one already).
 */
export function movedRow(
  seat: FloorSeat,
  move: Move,
  existing: GuestFloorCheckinRow | null,
  nowIso: string
): GuestFloorCheckinRow {
  return {
    booking_id: String(seat.booking.id),
    session_id: seat.session.id,
    member_id: bookingMember(seat.booking)?.memberId || null,
    checked_in_at: move.arrivedAt,
    session_minutes: null,
    checkpoints_done: { ...move.checkpointsDone, ...(existing?.checkpoints_done ?? {}) },
    moved_from_booking_id: move.fromBookingId,
    moved_from_session_id: move.fromSessionId,
    checked_out_at: null,
    checked_out_by: null,
    updated_by: MOVE_ACTOR,
    created_at: existing?.created_at ?? nowIso,
    updated_at: nowIso,
  };
}

/** One session's live bookings joined with our recorded check-ins. */
export function floorGuests(
  session: FloorSession,
  bookings: SessionBooking[],
  rows: Map<string, GuestFloorCheckinRow>,
  { moves, superseded }: Moves = { moves: new Map(), superseded: new Set() },
  sessions: Map<string, FloorSession> = new Map()
): FloorGuest[] {
  const moveInfo = (sessionId: string, arrivedAt: string): FloorMove => {
    const from = sessions.get(sessionId);
    return {
      sessionId,
      sessionName: from?.name ?? null,
      sessionMinutes: from?.minutes ?? null,
      arrivedAt,
    };
  };

  const guests: FloorGuest[] = [];
  for (const booking of bookings) {
    const bookingId = String(booking.id);
    if (booking.cancelledAt || superseded.has(bookingId)) continue;
    const person = bookingMember(booking);
    // A time Momence sent us, or one carried over from a move, stands only
    // while Momence still has them checked in, so un-checking someone there
    // takes them off the floor. One recorded or corrected here stands on its
    // own.
    const stored = rows.get(bookingId) ?? null;
    const row =
      stored &&
      ((stored.updated_by !== MOMENCE_ACTOR && stored.updated_by !== MOVE_ACTOR) ||
        booking.checkedIn)
        ? stored
        : null;
    const checkedIn = booking.checkedIn || row !== null;
    const checkedInAt = row
      ? row.checked_in_at
      : booking.checkedIn
        ? estimateCheckIn(session.startsAt, booking.createdAt)
        : null;
    const move = moves.get(bookingId);
    const movedFrom = row?.moved_from_session_id
      ? moveInfo(row.moved_from_session_id, row.checked_in_at)
      : move && !checkedIn
        ? moveInfo(move.fromSessionId, move.arrivedAt)
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
      checkedOutAt: row?.checked_out_at ?? null,
      movedFrom,
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

/**
 * Everyone booked into the window's sessions, with their check-in times.
 * A move into a booking that is now checked in is written through here, the
 * first time the floor sees it, so its carried time is an ordinary row from
 * then on (edits, the webhook, undo all treat it like any other).
 */
export async function loadFloor(db: SupabaseClient, nowMs: number): Promise<Floor> {
  const sessions = await loadFloorSessions(nowMs);
  if (sessions.length === 0) return { sessions, guests: [], complete: true };

  const bookingResults = await Promise.allSettled(
    sessions.map((s) => fetchSessionBookings(Number(s.id)))
  );

  let complete = true;
  const bySession: { session: FloorSession; bookings: SessionBooking[] }[] = [];
  bookingResults.forEach((result, i) => {
    if (result.status === 'rejected') {
      complete = false;
      console.error(
        `[guests/floor] bookings for session ${sessions[i].id} failed:`,
        result.reason instanceof Error ? result.reason.message : result.reason
      );
      return;
    }
    bySession.push({ session: sessions[i], bookings: result.value });
  });
  const seats: FloorSeat[] = bySession.flatMap(({ session, bookings }) =>
    bookings.map((booking) => ({ session, booking }))
  );
  if (seats.length === 0) return { sessions, guests: [], complete };

  // By booking, not session: a booking's time stays with it whatever
  // session it is on.
  const rowsResult = await db
    .from('guest_floor_checkins')
    .select('*')
    .in(
      'booking_id',
      seats.map((s) => String(s.booking.id))
    );
  if (rowsResult.error) throw new Error(rowsResult.error.message);
  const rows = new Map(
    ((rowsResult.data ?? []) as GuestFloorCheckinRow[]).map((r) => [r.booking_id, r])
  );

  const found = findMoves(seats, rows);
  const { moves } = found;
  const nowIso = new Date(nowMs).toISOString();
  for (const seat of seats) {
    const bookingId = String(seat.booking.id);
    const move = moves.get(bookingId);
    if (!move || !seat.booking.checkedIn) continue;
    const row = movedRow(seat, move, rows.get(bookingId) ?? null, nowIso);
    rows.set(bookingId, row);
    const { error } = await db
      .from('guest_floor_checkins')
      .upsert(row, { onConflict: 'booking_id' });
    if (error) console.error(`[guests/floor] carrying move to ${bookingId} failed:`, error.message);
  }

  const byId = new Map(sessions.map((s) => [s.id, s]));
  const guests = bySession.flatMap(({ session, bookings }) =>
    floorGuests(session, bookings, rows, found, byId)
  );
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
 * old one, and any check-out. A retried or out-of-order delivery (same or earlier time) changes
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
    checked_out_at: null,
    checked_out_by: null,
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
