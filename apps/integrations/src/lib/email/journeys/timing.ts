import type { JourneyStep, StepTiming } from './schema';

// Scheduling maths for the engine, kept pure so it can be tested without a
// database or Momence.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const STUDIO_TIME_ZONE = 'America/New_York';
/** Journey email only goes out between these local hours (start inclusive, end exclusive). */
export const SEND_WINDOW = { startHour: 9, endHour: 20 } as const;

/** An anchored step this late (e.g. after a pause) is skipped rather than sent stale. */
export const MAX_ANCHORED_LATENESS_MS = DAY;

/** Marketing frequency cap across every journey, per recipient. */
export const FREQUENCY_CAP = [
  { windowMs: DAY, max: 1 },
  { windowMs: 7 * DAY, max: 3 },
] as const;

export interface AnchorTimes {
  /** When the trigger happened: the booked session's end, or the enrollment time. */
  triggerAt: number;
  /** When the previous step ran (sent or skipped); null before the first step. */
  previousAt: number | null;
  /** When their intro offer pack expires; null when they have none. */
  introExpiresAt: number | null;
}

export function anchorTime(timing: StepTiming, anchors: AnchorTimes): number | null {
  switch (timing.anchor) {
    case 'trigger':
      return anchors.triggerAt;
    case 'previous':
      return anchors.previousAt ?? anchors.triggerAt;
    case 'intro-expiry':
      return anchors.introExpiresAt;
  }
}

/**
 * When a step is due, or null when its anchor is unknown (no intro offer).
 * Fast mode (JOURNEY_FAST_MODE) compresses everything after the trigger 60x —
 * hours become minutes — so a whitelist test walks a multi-week journey in
 * an afternoon.
 */
export function stepDueAt(
  timing: StepTiming,
  anchors: AnchorTimes,
  { fastMode = false }: { fastMode?: boolean } = {}
): number | null {
  const anchor = anchorTime(timing, anchors);
  if (anchor === null) return null;
  const due = anchor + timing.offsetHours * HOUR;
  if (!fastMode) return due;
  return anchors.triggerAt + (due - anchors.triggerAt) / 60;
}

/**
 * Whether a due step is too late to still make sense. Steps timed from the
 * previous email never go stale (that's today's "N hours after the last one"
 * behaviour); anchored ones do — a "your intro expires in 2 days" email must
 * not go out after it expired.
 */
export function isStale(
  timing: StepTiming,
  dueAt: number,
  anchors: AnchorTimes,
  now: number
): boolean {
  if (timing.anchor === 'previous') return false;
  if (
    timing.anchor === 'intro-expiry' &&
    timing.offsetHours < 0 &&
    anchors.introExpiresAt !== null &&
    now >= anchors.introExpiresAt
  ) {
    return true;
  }
  return now - dueAt > MAX_ANCHORED_LATENESS_MS;
}

/** Index of the step to run after `currentKey` (null = start), skipping archived steps. */
export function nextStepIndex(steps: JourneyStep[], currentKey: string | null): number | null {
  let start = 0;
  if (currentKey !== null) {
    const at = steps.findIndex((s) => s.key === currentKey);
    if (at === -1) return null;
    start = at + 1;
  }
  for (let i = start; i < steps.length; i += 1) {
    if (!steps[i].archived) return i;
  }
  return null;
}

/** First runnable step at or after `currentKey` — where an enrollment resumes. */
export function currentStepIndex(steps: JourneyStep[], currentKey: string): number | null {
  const at = steps.findIndex((s) => s.key === currentKey);
  if (at === -1) return null;
  for (let i = at; i < steps.length; i += 1) {
    if (!steps[i].archived) return i;
  }
  return null;
}

// --- Send window ---

function zonedParts(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** UTC ms for a wall-clock time in `timeZone` (DST-safe to the hour). */
function zonedTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  timeZone: string
): number {
  const guess = Date.UTC(year, month - 1, day, hour);
  const p = zonedParts(guess, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return guess - (asIfUtc - guess);
}

/** Push a time outside the studio's send window to the next window opening. */
export function clampToSendWindow(
  ms: number,
  {
    timeZone = STUDIO_TIME_ZONE,
    startHour = SEND_WINDOW.startHour,
    endHour = SEND_WINDOW.endHour,
  } = {}
): number {
  const p = zonedParts(ms, timeZone);
  if (p.hour >= startHour && p.hour < endHour) return ms;
  if (p.hour < startHour) return zonedTime(p.year, p.month, p.day, startHour, timeZone);
  // After hours: the next day's opening. Date.UTC normalises day overflow.
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return zonedTime(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    startHour,
    timeZone
  );
}

// --- Frequency cap ---

/**
 * When the next marketing email may go to someone, given when their recent
 * ones went (any order), or null if one may go now.
 */
export function frequencyCapUntil(recentSentAt: number[], now: number): number | null {
  const sorted = [...recentSentAt].sort((a, b) => b - a);
  let until: number | null = null;
  for (const { windowMs, max } of FREQUENCY_CAP) {
    const inWindow = sorted.filter((t) => now - t < windowMs);
    if (inWindow.length >= max) {
      // The window frees up once the oldest send that keeps it full ages out.
      const freesAt = inWindow[max - 1] + windowMs;
      until = until === null ? freesAt : Math.max(until, freesAt);
    }
  }
  return until;
}

// --- Send keys ---

/** The email_sends dedupe key for one step of one run. */
export function sendKeyFor(
  journeyId: string,
  memberId: number,
  stepKey: string,
  cycle: number
): string {
  // Cycle 0 keeps the original key shape, so journeys converted from code
  // never re-send a step someone already received.
  const base = `journey:${journeyId}:${memberId}:${stepKey}`;
  return cycle === 0 ? base : `${base}:c${cycle}`;
}
