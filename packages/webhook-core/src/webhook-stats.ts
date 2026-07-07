import type { Redis } from '@upstash/redis';
import { getRedis } from './redis';

// Daily webhook aggregate counters. Execution records expire after 14 days, so
// these counters are the durable source for long-range health trends. They are
// written inline with each recordExecution and never expire.
//
// Key contract:
//   stats:webhook:day:<YYYY-MM-DD>  — hash, one per day (America/New_York)
//     total          — executions that day
//     errors         — executions with status 'error'
//     durationSumMs  — sum of durationMs (daily avg = durationSumMs / total)
//     t:<eventType>  — per-event-type total
//     e:<eventType>  — per-event-type errors
//   stats:webhook:live-since  — timestamp (ms) of the first live-counted record;
//                               backfill only replays records older than this
//   stats:webhook:backfilled  — flag set once historical records were replayed
const DAY_KEY_PREFIX = 'stats:webhook:day:';
const LIVE_SINCE_KEY = 'stats:webhook:live-since';
const BACKFILL_FLAG_KEY = 'stats:webhook:backfilled';

export const STATS_TIMEZONE = 'America/New_York';

type RedisPipeline = ReturnType<Redis['pipeline']>;

/** The subset of an execution record the daily counters need. */
export interface StatsInput {
  timestamp: number;
  eventType: string;
  status: 'success' | 'error';
  durationMs: number;
}

export interface DailyStat {
  date: string; // YYYY-MM-DD in STATS_TIMEZONE
  total: number;
  errors: number;
  avgDurationMs: number;
  byEventType: Record<string, { total: number; errors: number }>;
}

// en-CA formats as YYYY-MM-DD, which sorts lexicographically.
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: STATS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function dayKeyFor(timestamp: number): string {
  return `${DAY_KEY_PREFIX}${dayFormatter.format(new Date(timestamp))}`;
}

function addCounterOps(pipeline: RedisPipeline, record: StatsInput): void {
  const key = dayKeyFor(record.timestamp);
  pipeline.hincrby(key, 'total', 1);
  pipeline.hincrby(key, 'durationSumMs', Math.max(0, Math.round(record.durationMs)));
  pipeline.hincrby(key, `t:${record.eventType}`, 1);
  if (record.status === 'error') {
    pipeline.hincrby(key, 'errors', 1);
    pipeline.hincrby(key, `e:${record.eventType}`, 1);
  }
}

/**
 * Append daily-counter increments to an existing pipeline (called from
 * recordExecution so counters and the execution record commit together).
 * Also stamps live-since on first use so backfill knows where live counting
 * began and never double-counts.
 */
export function appendDailyStats(pipeline: RedisPipeline, record: StatsInput): void {
  addCounterOps(pipeline, record);
  pipeline.set(LIVE_SINCE_KEY, record.timestamp, { nx: true });
}

/**
 * One-time replay of pre-existing execution records into the daily counters.
 * Only records older than live-since are counted (anything newer was already
 * counted inline by appendDailyStats). Safe to call repeatedly; no-ops after
 * the first successful run.
 */
export async function backfillDailyStats(
  loadRecords: () => Promise<StatsInput[]>
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;

  const alreadyDone = await redis.exists(BACKFILL_FLAG_KEY);
  if (alreadyDone) return false;

  const records = await loadRecords();
  const liveSince = Number((await redis.get(LIVE_SINCE_KEY)) ?? Date.now());
  const eligible = records.filter((r) => r.timestamp < liveSince);

  const pipeline = redis.pipeline();
  for (const record of eligible) {
    addCounterOps(pipeline, record);
  }
  pipeline.set(BACKFILL_FLAG_KEY, Date.now());
  await pipeline.exec();

  return true;
}

function parseDayHash(date: string, hash: Record<string, unknown> | null): DailyStat {
  const stat: DailyStat = { date, total: 0, errors: 0, avgDurationMs: 0, byEventType: {} };
  if (!hash) return stat;

  let durationSumMs = 0;
  for (const [field, raw] of Object.entries(hash)) {
    const value = Number(raw) || 0;
    if (field === 'total') stat.total = value;
    else if (field === 'errors') stat.errors = value;
    else if (field === 'durationSumMs') durationSumMs = value;
    else if (field.startsWith('t:') || field.startsWith('e:')) {
      const eventType = field.slice(2);
      const entry = (stat.byEventType[eventType] ??= { total: 0, errors: 0 });
      if (field.startsWith('t:')) entry.total = value;
      else entry.errors = value;
    }
  }
  stat.avgDurationMs = stat.total > 0 ? Math.round(durationSumMs / stat.total) : 0;
  return stat;
}

/** Daily stats for the last `days` days (oldest first), zero-filled for quiet days. */
export async function getDailyStats(days: number): Promise<DailyStat[]> {
  const redis = getRedis();
  if (!redis) return [];

  const now = Date.now();
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = dayFormatter.format(new Date(now - i * 24 * 60 * 60 * 1000));
    if (dates[dates.length - 1] !== date) dates.push(date); // DST shifts can repeat a day
  }

  const pipeline = redis.pipeline();
  for (const date of dates) {
    pipeline.hgetall(`${DAY_KEY_PREFIX}${date}`);
  }
  const results = await pipeline.exec<Array<Record<string, unknown> | null>>();

  return dates.map((date, i) => parseDayHash(date, results[i] ?? null));
}
