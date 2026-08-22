// When the /admin/business syncs last ran, and when they run next.
//
// Both daily jobs (business-report-sync, business-activity-sync) ride the
// single hourly QStash tick and gate themselves identically: the first tick at
// or after SYNC_HOUR_ET starts the day's run, and a Redis done-key stops a
// second one the same day. That gate IS the schedule, so "when does this
// refresh next" is derivable from the clock plus the job's last write — the
// dashboard never has to read the cursor state to answer it.

import { addDays, easternToUtc, utcToEastern } from '@pyre/schedule-core';

/** ET hour from which the daily syncs may start. */
export const SYNC_HOUR_ET = 6;

/** Wall-clock form of SYNC_HOUR_ET, for easternToUtc. */
const SYNC_TIME_ET = `${String(SYNC_HOUR_ET).padStart(2, '0')}:00`;

/**
 * A sync older than this is late enough to warn about: the jobs run daily, so
 * a day plus slack for a tick that had to resume.
 */
export const SYNC_STALE_HOURS = 26;

const HOUR_MS = 3_600_000;

/** The next top-of-hour tick strictly after `nowIso`. ET offsets are whole
 * hours, so a UTC hour boundary is an ET one too. */
function nextTick(nowIso: string): string {
  return new Date(Math.floor(Date.parse(nowIso) / HOUR_MS) * HOUR_MS + HOUR_MS).toISOString();
}

/**
 * When one daily job next gets a chance to run, given when it last wrote.
 *
 * Approximate in exactly one direction, on purpose: a job that wrote today but
 * ran out of tick budget resumes from its cursor on the very next tick, which
 * this reports as tomorrow morning. It errs late, never early — quietly
 * promising a refresh that isn't coming is the worse failure.
 */
export function nextSyncAfter(nowIso: string, lastSyncedAt: string | null): string {
  const now = utcToEastern(nowIso);

  // Wrote today → the done-key holds until tomorrow's gate opens.
  if (lastSyncedAt !== null && utcToEastern(lastSyncedAt).date === now.date) {
    return easternToUtc(addDays(now.date, 1), SYNC_TIME_ET);
  }
  // Gate still shut → today's opening tick.
  if (now.minutes < SYNC_HOUR_ET * 60) return easternToUtc(now.date, SYNC_TIME_ET);
  // Gate open, nothing written today → whenever the next tick lands.
  return nextTick(nowIso);
}

/** Hours since a timestamp; Infinity for a job that has never written. */
export function hoursSince(nowIso: string, iso: string | null): number {
  if (iso === null) return Number.POSITIVE_INFINITY;
  return (Date.parse(nowIso) - Date.parse(iso)) / HOUR_MS;
}
