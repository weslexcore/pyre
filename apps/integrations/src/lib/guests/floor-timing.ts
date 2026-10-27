// The client-safe half of lib/guests/floor.ts: the shapes the floor route
// returns and the timing math, which the island re-runs every few seconds
// between fetches so the bars move without a round trip.

/** Warn a guest when this much of their session is left. */
export const WARNING_MINUTES = 15;
/** Sessions that started up to this long ago may still have guests in. */
export const LOOKBACK_MINUTES = 4 * 60;
/** Sessions starting this soon are listed, so arrivals can be checked in. */
export const LOOKAHEAD_MINUTES = 60;
/** A guest stays on the list this long after their time is up. */
export const OVERTIME_GRACE_MINUTES = 30;
/** Session lengths offered when a guest's differs from the schedule's. */
export const SESSION_LENGTH_CHOICES = [30, 45, 60, 75, 90, 120] as const;

export const MINUTE_MS = 60_000;

export interface FloorSession {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  /** The scheduled length — every guest's default. */
  minutes: number;
}

export interface FloorGuest {
  bookingId: string;
  sessionId: string;
  memberId: string;
  name: string;
  /** Seats on this booking — a guest bringing a friend books two. */
  seats: number;
  /** Momence's flag: checked in, by us or anyone else. */
  checkedIn: boolean;
  /** When their time started; null until they are checked in. */
  checkedInAt: string | null;
  /** True when checkedInAt is our guess, not a recorded time. */
  estimated: boolean;
  /** How long their session runs. */
  minutes: number;
  /** True when someone set a length other than the session's. */
  customMinutes: boolean;
  warnedAt: string | null;
  warnedBy: string | null;
}

export interface Floor {
  sessions: FloorSession[];
  guests: FloorGuest[];
  /** False when one or more sessions' bookings couldn't be read. */
  complete: boolean;
}

export type FloorStatus = 'waiting' | 'in' | 'warn' | 'over';

export interface FloorTiming {
  status: FloorStatus;
  /** 0–1 share of their session behind them. */
  progress: number;
  /** Negative once they are over. */
  remainingMs: number;
  endsAt: number | null;
}

export function floorTiming(
  guest: Pick<FloorGuest, 'checkedInAt' | 'minutes'>,
  nowMs: number
): FloorTiming {
  const start = guest.checkedInAt ? Date.parse(guest.checkedInAt) : Number.NaN;
  if (!Number.isFinite(start)) {
    return { status: 'waiting', progress: 0, remainingMs: guest.minutes * MINUTE_MS, endsAt: null };
  }
  const totalMs = guest.minutes * MINUTE_MS;
  const endsAt = start + totalMs;
  const remainingMs = endsAt - nowMs;
  const progress = Math.min(1, Math.max(0, (nowMs - start) / totalMs));
  const status: FloorStatus =
    remainingMs <= 0 ? 'over' : remainingMs <= WARNING_MINUTES * MINUTE_MS ? 'warn' : 'in';
  return { status, progress, remainingMs, endsAt };
}

/** Still worth listing: waiting, in, or not long over. */
export function onFloor(timing: FloorTiming): boolean {
  return timing.status !== 'over' || timing.remainingMs > -OVERTIME_GRACE_MINUTES * MINUTE_MS;
}

/**
 * Checked-in guests by who needs attention first: the warning due now, then
 * whoever is over, then the rest by time left.
 */
export function compareFloor(a: FloorTiming, b: FloorTiming): number {
  const rank = (t: FloorTiming) => (t.status === 'warn' ? 0 : t.status === 'over' ? 1 : 2);
  return rank(a) - rank(b) || a.remainingMs - b.remainingMs;
}
