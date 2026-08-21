// The daily Momence report pull behind /admin/business. Once a day (first
// hourly tick at/after 6am ET), create one report run per DAILY_REPORTS type
// over a trailing window, poll until each completes, and persist:
//
//   momence_report_snapshots   raw items, verbatim (re-normalization source)
//   business_metrics_daily     normalized daily series (what the page reads)
//
// Every run covers the whole trailing window and upserts in place, so late
// refunds, cancellations, and edited attendance self-heal daily with no
// incremental bookkeeping. Runs that outlive the tick's time budget persist a
// cursor holding the created run ids; the next tick resumes GET-only (report
// creation spends a 100/day budget, polling a 1000/day one).
//
// Dry runs never create report runs — creation is the scarce resource.

import { addDays, utcToEastern, weekStartOf } from '@pyre/schedule-core';
import { getRedis } from '@pyre/webhook-core';
import type { CronJobContext } from '@/lib/cron/jobs';
import { getDb } from '@/lib/db';
import {
  createReportRun,
  getReportRun,
  type MomenceReportType,
  ReportUnavailableError,
} from '@/lib/momence/reports';
import { normalizeReport } from '@/lib/reports/normalize';

/**
 * The daily pull set: 1 create/day of the 100/day budget.
 *
 * Only TOTAL_SALES exists — POST /host/reports rejects every other report
 * name with a 400 (see MomenceReportType). The membership-flow and
 * attendance metrics the dashboard renders are therefore *not* report-run
 * sourced; they need a different collector built on the host endpoints that
 * do expose them (/host/sessions carries capacity + bookingCount,
 * /host/sessions/{id}/bookings carries checkedIn, /host/members carries
 * firstSeen). Until that exists those metrics stay null on /admin/business.
 */
export const DAILY_REPORTS: MomenceReportType[] = ['TOTAL_SALES'];

/** ET hour from which the daily sync may start. */
const SYNC_HOUR_ET = 6;

/** Trailing window: this many weeks back from the current Monday. */
const DEFAULT_WEEKS_BACK = 12;

/** Stop starting new work with less than this left in the tick budget. */
const TIME_FLOOR_MS = 10_000;

/** raw_items cap per snapshot; beyond it the tail is dropped and the
 * snapshot flagged parse-partial (the daily metrics still use every item). */
const RAW_ITEM_CAP = 5_000;

const DONE_TTL_SECONDS = 60 * 60 * 48;
const POLL_DELAYS_MS = [2_000, 4_000, 8_000];

interface PendingRun {
  reportType: MomenceReportType;
  runId: number;
}

interface SyncCursor {
  /** ET day the runs were created — snapshots key on this even when a
   * resume happens after midnight. */
  date: string;
  rangeFrom: string;
  rangeTo: string;
  pending: PendingRun[];
  failed: Array<{ reportType: string; error: string }>;
}

export interface ReportSyncSummary {
  created: number;
  completed: number;
  failedTypes: string[];
  metricsUpserted: number;
  resumed: boolean;
  skipped?: string;
  outOfTime?: boolean;
  wouldCreate?: string[];
  pendingTypes?: string[];
}

export interface ReportSyncOptions {
  /** Override the trailing window (backfill). */
  weeksBack?: number;
  /** Skip day-gating and the done-key (backfill / manual reruns). */
  force?: boolean;
  /** Separate cursor namespace so a backfill never collides with the daily
   * job's state. */
  redisPrefix?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function runBusinessReportSync(
  ctx: CronJobContext,
  opts: ReportSyncOptions = {}
): Promise<ReportSyncSummary> {
  const prefix = opts.redisPrefix ?? 'report-sync';
  const force = opts.force ?? false;
  const weeksBack = opts.weeksBack ?? DEFAULT_WEEKS_BACK;

  const summary: ReportSyncSummary = {
    created: 0,
    completed: 0,
    failedTypes: [],
    metricsUpserted: 0,
    resumed: false,
  };

  const redis = getRedis();
  if (!redis) return { ...summary, skipped: 'redis-unavailable' };
  const db = getDb();
  if (!db) return { ...summary, skipped: 'db-unavailable' };

  const eastern = utcToEastern(new Date().toISOString());
  const today = eastern.date;
  const cursorKey = `${prefix}:cursor`;
  const doneKey = `${prefix}:done:${today}`;

  let cursor = (await redis.get<SyncCursor>(cursorKey)) ?? null;

  // Day gate (daily mode only): resume an unfinished cursor any hour, but
  // don't start a fresh day's pull before the sync hour or twice in a day.
  if (!force && !cursor) {
    if (eastern.minutes < SYNC_HOUR_ET * 60) return { ...summary, skipped: 'before-sync-hour' };
    if (await redis.get(doneKey)) return { ...summary, skipped: 'already-done' };
  }

  if (!cursor) {
    // Trailing window: from N weeks before the current Monday through today.
    const rangeFrom = addDays(weekStartOf(today), -7 * weeksBack);
    const rangeTo = today;

    if (ctx.dryRun) {
      return {
        ...summary,
        wouldCreate: DAILY_REPORTS,
        skipped: `dry-run (range ${rangeFrom}..${rangeTo})`,
      };
    }

    const pending: PendingRun[] = [];
    const failed: SyncCursor['failed'] = [];
    for (const reportType of DAILY_REPORTS) {
      if (ctx.timeRemainingMs() < TIME_FLOOR_MS) break;
      try {
        const runId = await createReportRun({ reportType, from: rangeFrom, to: rangeTo });
        pending.push({ reportType, runId });
        summary.created += 1;
      } catch (error) {
        // Unavailable (bad type / plan / scope) and transient failures both
        // land here: the day's snapshot for that type just doesn't happen,
        // and tomorrow's full-window run self-heals if it was transient.
        failed.push({
          reportType,
          error: error instanceof Error ? error.message : String(error),
        });
        if (!(error instanceof ReportUnavailableError)) {
          console.error(`[report-sync] create ${reportType} failed:`, error);
        }
      }
    }

    cursor = { date: today, rangeFrom, rangeTo, pending, failed };
    await redis.set(cursorKey, cursor);
  } else {
    summary.resumed = true;
    if (ctx.dryRun) {
      return {
        ...summary,
        skipped: 'dry-run (cursor pending)',
        pendingTypes: cursor.pending.map((p) => p.reportType),
      };
    }
  }

  // Poll pending runs, persisting each as it completes. Bounded backoff per
  // tick; whatever is still running resumes GET-only on the next tick.
  for (let round = 0; cursor.pending.length > 0 && round <= POLL_DELAYS_MS.length; round += 1) {
    if (round > 0) {
      const delay = POLL_DELAYS_MS[round - 1];
      if (delay === undefined || ctx.timeRemainingMs() < TIME_FLOOR_MS + delay) break;
      await sleep(delay);
    }

    const stillPending: PendingRun[] = [];
    for (const run of cursor.pending) {
      if (ctx.timeRemainingMs() < TIME_FLOOR_MS) {
        stillPending.push(run);
        continue;
      }
      try {
        const result = await getReportRun(run.runId);
        if (result.status !== 'completed' || result.data === null) {
          stillPending.push(run);
          continue;
        }
        const upserted = await persistReport(run, result.data.items, cursor);
        summary.completed += 1;
        summary.metricsUpserted += upserted;
      } catch (error) {
        console.error(`[report-sync] poll ${run.reportType} #${run.runId} failed:`, error);
        stillPending.push(run);
      }
    }
    cursor.pending = stillPending;
  }

  summary.failedTypes = cursor.failed.map((f) => f.reportType);

  if (cursor.pending.length > 0) {
    await redis.set(cursorKey, cursor);
    return {
      ...summary,
      outOfTime: true,
      pendingTypes: cursor.pending.map((p) => p.reportType),
    };
  }

  await redis.del(cursorKey);
  // Keyed on the cursor's day, not today's: a resume that finishes after
  // midnight must not block the new day's pull.
  if (!force) {
    await redis.set(
      `${prefix}:done:${cursor.date}`,
      { finishedAt: new Date().toISOString() },
      { ex: DONE_TTL_SECONDS }
    );
  }
  return summary;
}

/** Upsert one completed report: raw snapshot row + normalized daily rows.
 * Returns how many daily metric rows were written. */
async function persistReport(
  run: PendingRun,
  items: unknown[],
  cursor: SyncCursor
): Promise<number> {
  const db = getDb();
  if (!db) throw new Error('Storage unavailable');

  const normalized = normalizeReport(run.reportType, items, cursor.date);
  const truncated = items.length > RAW_ITEM_CAP;
  const status = truncated && normalized.status === 'ok' ? 'parse-partial' : normalized.status;

  const { error: snapshotError } = await db.from('momence_report_snapshots').upsert(
    {
      report_type: run.reportType,
      snapshot_date: cursor.date,
      range_from: cursor.rangeFrom,
      range_to: cursor.rangeTo,
      report_run_id: run.runId,
      raw_items: truncated ? items.slice(0, RAW_ITEM_CAP) : items,
      item_count: items.length,
      normalize_status: status,
    },
    { onConflict: 'report_type,snapshot_date' }
  );
  if (snapshotError) throw new Error(`snapshot upsert failed: ${snapshotError.message}`);

  if (normalized.metrics.length === 0) return 0;

  const { error: metricsError } = await db.from('business_metrics_daily').upsert(
    normalized.metrics.map((m) => ({
      metric_date: m.date,
      metric: m.metric,
      value: m.value,
      source_report_type: run.reportType,
      snapshot_date: cursor.date,
    })),
    { onConflict: 'metric_date,metric' }
  );
  if (metricsError) throw new Error(`metrics upsert failed: ${metricsError.message}`);

  return normalized.metrics.length;
}
