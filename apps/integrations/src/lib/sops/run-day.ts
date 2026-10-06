// The studio-day boundary for checklist runs. Pure, so the runs API, the
// cron sweep, and the client run engine all draw the line in the same place.

import { easternDate, easternToUtc } from '@pyre/schedule-core';
import type { SopRunRow } from '@/lib/db';

/**
 * The instant today's studio day began (midnight on the studio's wall clock),
 * as an ISO string. Runs are per day: an open run started before this is
 * stale — whoever left it short has gone home, and the next shift gets a
 * fresh checklist instead of inheriting yesterday's ticks.
 */
export function studioDayStart(now: Date = new Date()): string {
  return new Date(easternToUtc(easternDate(now), '00:00')).toISOString();
}

/** An in-progress run left over from an earlier studio day. */
export function isStaleRun(
  run: Pick<SopRunRow, 'status' | 'started_at'>,
  now: Date = new Date()
): boolean {
  return (
    run.status === 'in_progress' && Date.parse(run.started_at) < Date.parse(studioDayStart(now))
  );
}
