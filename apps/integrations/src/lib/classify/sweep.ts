// The classify sweep (cron job "classify-sweep", hourly): the backstop for
// background classification. scheduleClassification() runs after a note's
// response has gone out, and an instance can be frozen or recycled before it
// finishes. Every hour this looks at the records changed in the last two
// days and classifies any that are missing a result, whose result is for
// older text, or whose last try failed or stalled — up to MAX_ATTEMPTS tries
// per text, after which it is left failed for an admin to re-run.

import { SUBJECT_TYPES } from '@pyre/signals-core';
import type { CronJobContext } from '@/lib/cron/jobs';
import { type ContentClassificationRow, getDb } from '@/lib/db';
import { contentHash, MAX_ATTEMPTS, runClassification } from './request';
import { SUBJECT_SOURCES } from './subjects';
import { toClassificationView } from './view';

const LOOKBACK_MS = 48 * 60 * 60 * 1000;
const PER_SUBJECT_LIMIT = 200;
/** Leave headroom for the jobs after this one in the tick. */
const MIN_TIME_MS = 15_000;

type SweepRow = Pick<
  ContentClassificationRow,
  | 'subject_id'
  | 'status'
  | 'content_hash'
  | 'attempts'
  | 'requested_at'
  | 'signals'
  | 'classified_at'
>;

/** Whether a record's text still needs a (re)run. Exported for tests. */
export function needsClassification(
  row: SweepRow | undefined,
  text: string,
  now: number = Date.now()
): boolean {
  if (!row) return true;
  if (row.content_hash !== contentHash(text)) return true;
  if (row.attempts >= MAX_ATTEMPTS) return false;
  return toClassificationView(row, now).state === 'failed';
}

export async function runClassifySweep(ctx: CronJobContext): Promise<Record<string, unknown>> {
  const db = getDb();
  if (!db) return { skipped: 'storage unavailable' };
  if (!import.meta.env.AGENTS_BASE_URL || !import.meta.env.EVE_CHANNEL_SECRET) {
    return { skipped: 'classifier not configured' };
  }

  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const summary: Record<string, { checked: number; due: number; done: number; failed: number }> =
    {};

  for (const subject of SUBJECT_TYPES) {
    const records = await SUBJECT_SOURCES[subject].listChangedSince(db, since, PER_SUBJECT_LIMIT);
    const { data, error } = await db
      .from('content_classifications')
      .select('subject_id, status, content_hash, attempts, requested_at, signals, classified_at')
      .eq('subject_type', subject)
      .in(
        'subject_id',
        records.map((r) => r.id)
      );
    if (error) throw new Error(error.message);
    const rows = new Map(((data ?? []) as SweepRow[]).map((r) => [r.subject_id, r]));

    const due = records.filter((r) => needsClassification(rows.get(r.id), r.text));
    const tally = { checked: records.length, due: due.length, done: 0, failed: 0 };
    summary[subject] = tally;
    if (ctx.dryRun) continue;

    for (const record of due) {
      if (ctx.timeRemainingMs() < MIN_TIME_MS) break;
      const view = await runClassification(db, subject, record.id, record.text);
      if (view?.state === 'done') tally.done += 1;
      else tally.failed += 1;
    }
  }
  return summary;
}
