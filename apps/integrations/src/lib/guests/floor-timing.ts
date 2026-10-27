// The client-safe half of lib/guests/floor.ts: the shapes the floor route
// returns, the check-ins staff make with each guest (configured on
// /admin/settings as `floor.checkpoints`), and the timing math, which the
// island re-runs every few seconds between fetches so the bars move without
// a round trip.

/** Sessions that started up to this long ago may still have guests in. */
export const LOOKBACK_MINUTES = 4 * 60;
/** Sessions starting this soon are listed, so arrivals can be checked in. */
export const LOOKAHEAD_MINUTES = 60;
/** A guest stays on the list this long after their time and last check-in. */
export const OVERTIME_GRACE_MINUTES = 30;
/** Session lengths offered when a guest's differs from the schedule's. */
export const SESSION_LENGTH_CHOICES = [30, 45, 60, 75, 90, 120] as const;

export const MINUTE_MS = 60_000;

// --- Check-ins: the moments staff check on a guest ---

/** What a check-in's minutes count from. */
export const CHECKPOINT_FROM = ['after_arrival', 'before_end', 'after_end'] as const;
export type CheckpointFrom = (typeof CHECKPOINT_FROM)[number];

export const CHECKPOINT_FROM_LABELS: Record<CheckpointFrom, string> = {
  after_arrival: 'after they arrive',
  before_end: 'before their session ends',
  after_end: 'after their session ends',
};

export interface Checkpoint {
  /** Stable key, so a check-in marked done survives a relabel. */
  id: string;
  label: string;
  minutes: number;
  from: CheckpointFrom;
}

export const MAX_CHECKPOINTS = 20;
export const MAX_CHECKPOINT_MINUTES = 600;
export const MAX_CHECKPOINT_LABEL = 60;
const CHECKPOINT_ID_RE = /^[a-z0-9_-]{1,40}$/;

export const DEFAULT_CHECKPOINTS: Checkpoint[] = [
  { id: 'warning-15', label: '15-minute warning', minutes: 15, from: 'before_end' },
];

/** A saved or submitted check-in list, checked: the list, or why it doesn't fit. */
export function parseCheckpoints(
  raw: unknown
): { ok: true; value: Checkpoint[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'Check-ins must be a list' };
  if (raw.length > MAX_CHECKPOINTS) {
    return { ok: false, error: `At most ${MAX_CHECKPOINTS} check-ins` };
  }
  const seen = new Set<string>();
  const value: Checkpoint[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: 'Each check-in needs a label, minutes, and a starting point' };
    }
    const { id, label, minutes, from } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !CHECKPOINT_ID_RE.test(id) || seen.has(id)) {
      return { ok: false, error: 'Each check-in needs its own id' };
    }
    const text = typeof label === 'string' ? label.trim() : '';
    if (text.length < 1 || text.length > MAX_CHECKPOINT_LABEL) {
      return { ok: false, error: `Check-in labels are 1–${MAX_CHECKPOINT_LABEL} characters` };
    }
    if (
      typeof minutes !== 'number' ||
      !Number.isInteger(minutes) ||
      minutes < 0 ||
      minutes > MAX_CHECKPOINT_MINUTES
    ) {
      return {
        ok: false,
        error: `"${text}" needs whole minutes from 0 to ${MAX_CHECKPOINT_MINUTES}`,
      };
    }
    if (!CHECKPOINT_FROM.includes(from as CheckpointFrom)) {
      return { ok: false, error: `"${text}" needs a starting point` };
    }
    seen.add(id);
    value.push({ id, label: text, minutes, from: from as CheckpointFrom });
  }
  return { ok: true, value };
}

/** "15 min before their session ends". */
export function describeCheckpoint(checkpoint: Checkpoint): string {
  return `${checkpoint.minutes} min ${CHECKPOINT_FROM_LABELS[checkpoint.from]}`;
}

// --- The floor ---

export interface FloorSession {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  /** The scheduled length — every guest's default. */
  minutes: number;
}

/** A check-in someone marked done for a guest. */
export interface CheckpointDone {
  at: string;
  by: string;
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
  /** Check-ins marked done, by checkpoint id. */
  checkpointsDone: Record<string, CheckpointDone>;
  /**
   * Set when the guest was moved here from another session (booking
   * cancelled, rebooked into a longer or shorter one). Once they're checked
   * into this booking, their arrival time and done check-ins come with them;
   * before that, `arrivedAt` is what checking in will keep.
   */
  movedFrom: FloorMove | null;
}

export interface FloorMove {
  sessionId: string;
  /** Null when that session has left the floor's window. */
  sessionName: string | null;
  sessionMinutes: number | null;
  arrivedAt: string;
}

export interface Floor {
  sessions: FloorSession[];
  guests: FloorGuest[];
  /** False when one or more sessions' bookings couldn't be read. */
  complete: boolean;
}

/**
 *   waiting  not checked in
 *   in       in their session, nothing due
 *   due      a check-in is due and not done yet
 *   over     past their time, nothing due
 */
export type FloorStatus = 'waiting' | 'in' | 'due' | 'over';

export interface CheckpointTiming {
  checkpoint: Checkpoint;
  dueAt: number;
  done: CheckpointDone | null;
  /** Due and not done. */
  due: boolean;
}

export interface FloorTiming {
  status: FloorStatus;
  /** 0–1 share of their session behind them. */
  progress: number;
  /** Negative once they are over. */
  remainingMs: number;
  endsAt: number | null;
  /** Each check-in for this guest, in the order they come due. */
  checkpoints: CheckpointTiming[];
}

function dueAt(checkpoint: Checkpoint, start: number, end: number): number {
  const offset = checkpoint.minutes * MINUTE_MS;
  if (checkpoint.from === 'after_arrival') return start + offset;
  if (checkpoint.from === 'before_end') return Math.max(start, end - offset);
  return end + offset;
}

export function floorTiming(
  guest: Pick<FloorGuest, 'checkedInAt' | 'minutes' | 'checkpointsDone'>,
  checkpoints: Checkpoint[],
  nowMs: number
): FloorTiming {
  const start = guest.checkedInAt ? Date.parse(guest.checkedInAt) : Number.NaN;
  if (!Number.isFinite(start)) {
    return {
      status: 'waiting',
      progress: 0,
      remainingMs: guest.minutes * MINUTE_MS,
      endsAt: null,
      checkpoints: [],
    };
  }
  const totalMs = guest.minutes * MINUTE_MS;
  const endsAt = start + totalMs;
  const remainingMs = endsAt - nowMs;
  const progress = Math.min(1, Math.max(0, (nowMs - start) / totalMs));
  const timings = checkpoints
    .map((checkpoint) => {
      const at = dueAt(checkpoint, start, endsAt);
      const done = guest.checkpointsDone[checkpoint.id] ?? null;
      return { checkpoint, dueAt: at, done, due: !done && at <= nowMs };
    })
    .sort((a, b) => a.dueAt - b.dueAt);
  const status: FloorStatus = timings.some((t) => t.due) ? 'due' : remainingMs <= 0 ? 'over' : 'in';
  return { status, progress, remainingMs, endsAt, checkpoints: timings };
}

/** Still worth listing: until half an hour past their end and their last check-in. */
export function onFloor(timing: FloorTiming, nowMs: number): boolean {
  if (timing.endsAt === null) return true;
  if (timing.status === 'due') return true;
  const last = Math.max(timing.endsAt, ...timing.checkpoints.map((c) => c.dueAt));
  return nowMs < last + OVERTIME_GRACE_MINUTES * MINUTE_MS;
}

/** The earliest check-in due and not done, or null. */
function firstDue(timing: FloorTiming): number | null {
  return timing.checkpoints.find((c) => c.due)?.dueAt ?? null;
}

/**
 * Checked-in guests by who needs attention first: a check-in due now (the
 * longest-waiting first), then whoever is over, then the rest by time left.
 */
export function compareFloor(a: FloorTiming, b: FloorTiming): number {
  const rank = (t: FloorTiming) => (t.status === 'due' ? 0 : t.status === 'over' ? 1 : 2);
  return (
    rank(a) - rank(b) || (firstDue(a) ?? 0) - (firstDue(b) ?? 0) || a.remainingMs - b.remainingMs
  );
}
