// Coverage-window derivation: turn the day's Momence sessions and private
// appointments into staffing shift windows, and diff those windows against
// the shifts already in the database so the sync can create/update/cancel/
// flag without ever silently changing staffed work. Pure functions — the
// Momence fetch and the DB writes live in apps/integrations.

import { minutesToTime, timeToMinutes } from './availability';
import { addDays } from './hours';
import { easternToUtc, utcToEastern } from './tz';

export interface CoverageEvent {
  kind: 'session' | 'appointment';
  id: number;
  title: string;
  /** Local ET wall-clock (converted from Momence UTC before this layer). */
  date: string;
  startMin: number;
  endMin: number;
}

export interface WindowOptions {
  /** Staff arrive this many minutes before the first session. */
  leadMin: number;
  /** Staff stay this many minutes after the last session. */
  closeMin: number;
  /** Sessions closer together than this share one window. */
  mergeGapMin: number;
  defaultStaffNeeded: number;
  /**
   * A window longer than this is split into shifts, halved (at a :00/:30
   * boundary) until every piece fits — nobody is scheduled for a nine-hour
   * shift because Momence ran sessions all day.
   */
  maxShiftMin: number;
}

/** The longest a single shift may run; anything longer is two shifts. */
export const MAX_SHIFT_MIN = 8 * 60;

export const DEFAULT_WINDOW_OPTIONS: WindowOptions = {
  // 1.5h setup before the first session, 30min shutdown after the last.
  leadMin: 90,
  closeMin: 30,
  mergeGapMin: 90,
  defaultStaffNeeded: 2,
  maxShiftMin: MAX_SHIFT_MIN,
};

export interface CoverageWindow {
  date: string;
  startMin: number;
  endMin: number;
  label: string;
  staffNeeded: number;
  sessionRefs: Array<{ type: 'session' | 'appointment'; id: number }>;
  /**
   * Distinct titles of the covered events in first-seen order, for shift
   * notes/debugging. A day of hourly Open Hours slots is one session type, not
   * six — the count lives in sessionRefs.
   */
  titles: string[];
}

const DAY_MIN = 24 * 60;

/** Round outward to :00/:30 so windows look like human-made shifts. */
const floorHalfHour = (min: number) => Math.floor(min / 30) * 30;
const ceilHalfHour = (min: number) => Math.ceil(min / 30) * 30;

/** Label heuristic matching the sheet's vocabulary; admins can rename. */
export function labelForWindow(startMin: number, endMin: number): string {
  const startHour = startMin / 60;
  if (startHour < 10) return endMin - startMin > 6 * 60 ? 'Day' : 'Morning';
  if (startHour < 13.5) return 'Afternoon';
  return 'Evening';
}

/**
 * Merge a date-sorted set of events into padded coverage windows. Events on
 * different dates never merge; duplicate events (same kind + id) are dropped
 * so a session can never be counted into a window twice.
 */
export function deriveCoverageWindows(
  events: CoverageEvent[],
  options: WindowOptions = DEFAULT_WINDOW_OPTIONS
): CoverageWindow[] {
  const byDate = new Map<string, CoverageEvent[]>();
  const seen = new Set<string>();
  for (const event of events) {
    const key = `${event.kind}:${event.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = byDate.get(event.date) ?? [];
    list.push(event);
    byDate.set(event.date, list);
  }

  const windows: CoverageWindow[] = [];
  for (const [date, dayEvents] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...dayEvents].sort((a, b) => a.startMin - b.startMin);
    const dayWindows: CoverageWindow[] = [];
    // The events behind each merged window, so a split can hand each one to
    // the piece it starts in.
    const eventsOf = new Map<CoverageWindow, CoverageEvent[]>();
    let current: CoverageWindow | null = null;
    let currentPaddedEnd = 0;

    for (const event of sorted) {
      const paddedStart = Math.max(0, event.startMin - options.leadMin);
      const paddedEnd = Math.min(DAY_MIN, event.endMin + options.closeMin);

      if (current && paddedStart <= currentPaddedEnd + options.mergeGapMin) {
        currentPaddedEnd = Math.max(currentPaddedEnd, paddedEnd);
        current.endMin = ceilHalfHour(currentPaddedEnd);
        current.sessionRefs.push({ type: event.kind, id: event.id });
        if (!current.titles.includes(event.title)) current.titles.push(event.title);
        eventsOf.get(current)?.push(event);
      } else {
        current = {
          date,
          startMin: floorHalfHour(paddedStart),
          endMin: ceilHalfHour(paddedEnd),
          label: '',
          staffNeeded: options.defaultStaffNeeded,
          sessionRefs: [{ type: event.kind, id: event.id }],
          titles: [event.title],
        };
        currentPaddedEnd = paddedEnd;
        dayWindows.push(current);
        eventsOf.set(current, [event]);
      }
    }

    for (const window of dayWindows) {
      for (const piece of splitLongWindow(window, eventsOf.get(window) ?? [], options.maxShiftMin)) {
        piece.label = labelForWindow(piece.startMin, piece.endMin);
        windows.push(piece);
      }
    }
  }

  return windows;
}

/**
 * Halve a window longer than `maxShiftMin`, and keep halving until every
 * piece fits, so an all-day run of sessions becomes two shifts instead of
 * one nine-hour one. The cut lands on a :00/:30 boundary (rounded toward the
 * start). Each event belongs to the piece it starts in — never to both, so
 * the sync planner can't match one session to two shifts and swap them.
 */
export function splitLongWindow(
  window: CoverageWindow,
  events: CoverageEvent[],
  maxShiftMin: number
): CoverageWindow[] {
  const length = window.endMin - window.startMin;
  if (length <= maxShiftMin) return [window];

  const splitMin = window.startMin + floorHalfHour(length / 2);
  const piece = (startMin: number, endMin: number, own: CoverageEvent[]): CoverageWindow => ({
    date: window.date,
    startMin,
    endMin,
    label: '',
    staffNeeded: window.staffNeeded,
    sessionRefs: own.map((e) => ({ type: e.kind, id: e.id })),
    titles: [...new Set(own.map((e) => e.title))],
  });
  const first = events.filter((e) => e.startMin < splitMin);
  const second = events.filter((e) => e.startMin >= splitMin);
  return [
    ...splitLongWindow(piece(window.startMin, splitMin, first), first, maxShiftMin),
    ...splitLongWindow(piece(splitMin, window.endMin, second), second, maxShiftMin),
  ];
}

/**
 * Notes on a Momence-sourced shift are the window's comma-joined session
 * titles, so the schedule should read "Open Hours, Yoga" however many slots of
 * each the day holds. Titles are deduped at derivation now, but rows written
 * before that still repeat — collapse them on the way to the screen. Manual
 * notes are free text and pass through untouched.
 */
export function formatShiftNotes(shift: {
  source: 'momence' | 'manual';
  notes: string | null;
}): string | null {
  if (!shift.notes || shift.source !== 'momence') return shift.notes;
  const seen = new Set<string>();
  for (const part of shift.notes.split(',')) {
    const title = part.trim();
    if (title) seen.add(title);
  }
  return seen.size > 0 ? [...seen].join(', ') : shift.notes;
}

// --- Sync range: which instants to fetch, which shift dates to reconcile ---

export interface SyncRange {
  /** UTC ISO bounds for the Momence fetch. */
  startAfter: string;
  startBefore: string;
  /** Inclusive ET dates of the shifts to reconcile against those events. */
  rangeStart: string;
  rangeEnd: string;
}

/**
 * The sync's fetch and reconcile bounds for one run. Both start at ET
 * midnight of the first reconciled day, never at `now`: the planner diffs
 * whole shift rows, so it has to see every session on a day it touches.
 * Fetching from `now` made today's already-started sessions invisible — each
 * hourly run walked a staffed shift's start later and then, once the last
 * session had begun, flagged it as cancelled.
 *
 * `lookbackDays` pulls earlier days back into range so a manual run can repair
 * rows a past run got wrong; the cron uses 0.
 */
export function syncRange(
  nowIso: string,
  options: { horizonDays: number; lookbackDays?: number }
): SyncRange {
  const lookbackDays = options.lookbackDays ?? 0;
  const today = utcToEastern(nowIso).date;
  const rangeStart = addDays(today, -lookbackDays);
  const horizonEnd = new Date(Date.parse(nowIso) + options.horizonDays * 86_400_000);
  const startBefore = horizonEnd.toISOString();
  return {
    startAfter: easternToUtc(rangeStart, '00:00'),
    startBefore,
    rangeStart,
    rangeEnd: utcToEastern(startBefore).date,
  };
}

// --- Sync planning: diff derived windows against existing shifts ---

/** The slice of a shifts row (plus assignment count) the planner needs. */
export interface SyncShiftInput {
  id: string;
  shift_date: string;
  starts_at: string;
  ends_at: string;
  source: 'momence' | 'manual';
  momence_session_ids: Array<{ type: string; id: number }>;
  sync_locked: boolean;
  status: 'active' | 'cancelled';
  sync_flag: 'sessions_cancelled' | 'times_changed' | null;
  is_draft: boolean;
  assignmentCount: number;
}

export interface SyncPlan {
  create: CoverageWindow[];
  /** Unlocked momence shifts whose window moved — safe in-place updates. */
  update: Array<{ shiftId: string; startsAt: string; endsAt: string; sessionRefs: CoverageWindow['sessionRefs'] }>;
  /** Unassigned, unlocked momence shifts whose sessions all disappeared. */
  cancel: Array<{ shiftId: string; reason: string }>;
  /** Divergence on staffed/locked shifts — admin decides, nothing auto-changes. */
  flag: Array<{ shiftId: string; flag: 'sessions_cancelled' | 'times_changed' }>;
  /** Previously-flagged shifts whose divergence resolved. */
  clearFlag: string[];
}

const refKey = (ref: { type: string; id: number }) => `${ref.type}:${ref.id}`;

/**
 * Plan the sync for one horizon: match derived windows to existing
 * momence-sourced shifts (session-ref overlap first, then time overlap),
 * then classify every difference. Manual and draft shifts are never modified
 * — but an active manual shift that already covers a window (by session ref
 * or time overlap) suppresses creating a momence duplicate alongside it.
 */
export function planShiftSync(windows: CoverageWindow[], existing: SyncShiftInput[]): SyncPlan {
  const plan: SyncPlan = { create: [], update: [], cancel: [], flag: [], clearFlag: [] };
  const candidates = existing.filter((s) => s.source === 'momence' && !s.is_draft);
  const manualCover = existing.filter(
    (s) => s.source === 'manual' && !s.is_draft && s.status === 'active'
  );
  const matchedShiftIds = new Set<string>();

  for (const window of windows) {
    const windowRefs = new Set(window.sessionRefs.map(refKey));
    const sameDay = candidates.filter(
      (s) => s.shift_date === window.date && !matchedShiftIds.has(s.id)
    );

    let match =
      sameDay.find((s) => s.momence_session_ids.some((ref) => windowRefs.has(refKey(ref)))) ??
      sameDay.find(
        (s) =>
          timeToMinutes(s.starts_at) < window.endMin && timeToMinutes(s.ends_at) > window.startMin
      );

    if (!match) {
      const coveredManually = manualCover.some(
        (s) =>
          s.shift_date === window.date &&
          (s.momence_session_ids.some((ref) => windowRefs.has(refKey(ref))) ||
            (timeToMinutes(s.starts_at) < window.endMin &&
              timeToMinutes(s.ends_at) > window.startMin))
      );
      if (!coveredManually) plan.create.push(window);
      continue;
    }
    matchedShiftIds.add(match.id);

    const startsAt = minutesToTime(window.startMin);
    const endsAt = minutesToTime(window.endMin);
    const timesMatch =
      timeToMinutes(match.starts_at) === window.startMin &&
      timeToMinutes(match.ends_at) === window.endMin;
    const refsMatch =
      match.momence_session_ids.length === window.sessionRefs.length &&
      match.momence_session_ids.every((ref) => windowRefs.has(refKey(ref)));

    if (timesMatch && refsMatch) {
      if (match.sync_flag) plan.clearFlag.push(match.id);
      continue;
    }
    if (match.sync_locked) {
      if (!timesMatch && match.sync_flag !== 'times_changed') {
        plan.flag.push({ shiftId: match.id, flag: 'times_changed' });
      }
      continue;
    }
    plan.update.push({ shiftId: match.id, startsAt, endsAt, sessionRefs: window.sessionRefs });
  }

  // Shifts whose sessions all disappeared (deleted or cancelled in Momence).
  for (const shift of candidates) {
    if (matchedShiftIds.has(shift.id) || shift.status === 'cancelled') continue;
    if (shift.assignmentCount === 0 && !shift.sync_locked) {
      plan.cancel.push({ shiftId: shift.id, reason: 'Momence sessions removed' });
    } else if (shift.sync_flag !== 'sessions_cancelled') {
      plan.flag.push({ shiftId: shift.id, flag: 'sessions_cancelled' });
    }
  }

  return plan;
}
