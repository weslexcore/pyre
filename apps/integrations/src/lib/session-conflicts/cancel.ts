// Acting on a review: cancel the sessions an admin ticked, in Momence, and
// write down what happened to each one. Shared by the admin route; nothing
// on the cron side ever calls this — a person confirms every cancellation.

import { addDays, easternToUtc } from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SessionConflictReviewRow } from '@/lib/db';
import { cancelHostSession, cancelRouteStatus, fetchHostSessions } from '@/lib/momence/host-api';
import { uniqueSessionIds } from './detect';
import { applyResolution } from './store';
import { type CancelSupport, isHandled, type Resolution, type ResolutionEntry } from './types';

/** Stop starting new cancellations with less than this left in the budget. */
const TIME_FLOOR_MS = 5_000;

export const UNSUPPORTED_MESSAGE =
  'Momence has no session-cancel API on this account — cancel it from the Momence dashboard, then mark it handled.';

export interface CancelSelectedResult {
  /** The review after the outcomes were written; null when it was no longer open. */
  review: SessionConflictReviewRow | null;
  /** What happened to each session this call touched. */
  outcomes: Resolution;
  cancelSupport: CancelSupport;
  /** True when the budget ran out before every selected session was tried. */
  outOfTime: boolean;
}

/**
 * Cancel `sessionIds` (already validated as members of the review) in
 * Momence and record an outcome per session. Every id in the review gets an
 * entry: selected ones are cancelled / failed / unsupported / cleared,
 * unselected ones are `skipped` — left in place on purpose — so the review
 * closes the moment nothing is left undecided.
 */
export async function cancelSelectedSessions(
  db: SupabaseClient,
  review: SessionConflictReviewRow,
  sessionIds: number[],
  actor: string,
  timeRemainingMs: () => number = () => Number.POSITIVE_INFINITY,
  now = new Date()
): Promise<CancelSelectedResult> {
  const all = uniqueSessionIds(review.conflicts);
  const selected = new Set(sessionIds);
  const at = now.toISOString();
  const outcomes: Resolution = {};
  let outOfTime = false;

  // One list call tells us which sessions are still live; fetchHostSessions
  // already drops drafts and cancelled sessions, so "not in the list" means
  // "already off the schedule".
  const live = new Set(
    (
      await fetchHostSessions({
        startAfter: easternToUtc(review.horizon_start, '00:00'),
        startBefore: easternToUtc(addDays(review.horizon_end, 1), '00:00'),
      })
    ).map((s) => s.id)
  );

  for (const id of all) {
    const key = String(id);
    if (isHandled(review.resolution[key])) continue;

    if (!selected.has(id)) {
      // A session with a failed attempt behind it stays failed until the
      // admin selects it again; only undecided ones become skipped.
      if (review.resolution[key]) continue;
      outcomes[key] = { outcome: 'skipped', message: 'Left in place', at, by: actor };
      continue;
    }

    if (timeRemainingMs() < TIME_FLOOR_MS) {
      outOfTime = true;
      break;
    }

    if (!live.has(id)) {
      outcomes[key] = { outcome: 'cleared', message: 'Already off the schedule', at, by: actor };
      continue;
    }

    const result = await cancelHostSession(id);
    outcomes[key] = toEntry(result, at, actor);
  }

  const updated = await applyResolution(db, review.id, outcomes, actor, now);
  const counts = Object.values(outcomes).reduce<Record<string, number>>((acc, entry) => {
    acc[entry.outcome] = (acc[entry.outcome] ?? 0) + 1;
    return acc;
  }, {});
  console.info(
    `[session-conflicts] ${actor} acted on review ${review.id}: ${JSON.stringify(counts)}${
      outOfTime ? ' (out of time)' : ''
    }`
  );

  return { review: updated, outcomes, cancelSupport: cancelRouteStatus(), outOfTime };
}

function toEntry(
  result: Awaited<ReturnType<typeof cancelHostSession>>,
  at: string,
  by: string
): ResolutionEntry {
  switch (result.outcome) {
    case 'cancelled':
      return { outcome: 'cancelled', via: result.via, at, by };
    case 'unsupported':
      return { outcome: 'unsupported', message: UNSUPPORTED_MESSAGE, at, by };
    case 'error':
      return {
        outcome: 'failed',
        message: result.status ? `Momence ${result.status}: ${result.message}` : result.message,
        at,
        by,
      };
  }
}
