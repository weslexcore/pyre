// The second half of /admin/business: the metrics Momence's report API
// cannot produce.
//
// POST /host/reports only knows `total-sales` (see MomenceReportType), so
// attendance, no-shows, occupancy and membership counts have to be derived
// from the host endpoints that do carry them:
//
//   attendance        /host/sessions/{id}/bookings → checkedIn, ticketsBought
//   no_shows          the same list, minus check-ins and cancellations
//   session_capacity  /host/sessions → capacity (occupancy denominator)
//   session_booked    /host/sessions → bookingCount (occupancy numerator)
//   new_members       /host/members sorted by firstSeenAt
//   active_members    /host/members/list with filterPreset=with-active-membership
//
// membership_cancellations has no host endpoint behind it and is not
// produced — the dashboard no longer renders it.
//
// Cost shape: the session and member lists are a handful of requests for a
// whole quarter, but bookings are one request per session (~350ms, ~38
// sessions/week here). That does not fit the tick's shared 50s budget in one
// go, so the sweep walks whole weeks newest-first, persists each as it lands,
// and parks the rest in a redis cursor for the next tick — the same shape the
// report sync uses. A week is never persisted half-scanned.
//
// The scan walks weeks (the natural unit for the cursor and for "is this
// settled yet"), but every metric is bucketed and persisted per ET calendar
// day — the dashboard re-groups days into day/week/month ranges at read time.
// Momence timestamps are UTC instants, so every one is converted first.

import { addDays, completedWeekStarts, utcToEastern, weekStartOf } from '@pyre/schedule-core';
import { getRedis } from '@pyre/webhook-core';
import type { CronJobContext } from '@/lib/cron/jobs';
import { getDb } from '@/lib/db';
import {
  fetchHostSessions,
  fetchMembersFiltered,
  fetchSessionBookings,
} from '@/lib/momence/host-api';
import type { MetricKey, MetricUpsert } from '@/lib/reports/normalize';
import { SYNC_HOUR_ET } from '@/lib/reports/schedule';

/** Provenance stamp on rows this sweep writes (vs a report type). Exported so
 * the dashboard can find this job's newest write without guessing the string. */
export const HOST_API_SOURCE = 'HOST_API';

/** Trailing window: this many weeks back from the current Monday. */
const DEFAULT_WEEKS_BACK = 12;

/**
 * How many *completed* weeks back stay in the daily re-scan, on top of the
 * in-progress one — a late check-in or a cancellation keeps changing them.
 * Older weeks are settled and are only scanned if their rows are missing.
 */
const REFRESH_WEEKS = 2;

/** Don't start another session's bookings with less than this left. */
const TIME_FLOOR_MS = 8_000;

const DONE_TTL_SECONDS = 60 * 60 * 48;

/** Page cap when walking members newest-first; 100 members/page. */
const MAX_MEMBER_PAGES = 20;

interface ActivityCursor {
  /** ET day the sweep started — stamped on rows as their snapshot_date. */
  date: string;
  /** Weeks still to scan, newest first. */
  weeks: string[];
}

export interface ActivitySyncSummary {
  weeksProcessed: number;
  sessionsScanned: number;
  bookingsScanned: number;
  metricsUpserted: number;
  pendingWeeks: number;
  resumed: boolean;
  skipped?: string;
  outOfTime?: boolean;
  wouldScan?: number;
}

export interface ActivitySyncOptions {
  /** Override the trailing window (backfill). */
  weeksBack?: number;
  /** Skip day-gating and the done-key (backfill / manual reruns). */
  force?: boolean;
  /** Separate cursor namespace so a backfill never collides with the daily
   * job's state. */
  redisPrefix?: string;
}

/** ET calendar day of a Momence UTC timestamp. */
const easternDay = (iso: string): string => utcToEastern(iso).date;

export async function runActivityMetricsSync(
  ctx: CronJobContext,
  opts: ActivitySyncOptions = {}
): Promise<ActivitySyncSummary> {
  const prefix = opts.redisPrefix ?? 'activity-sync';
  const force = opts.force ?? false;
  const weeksBack = opts.weeksBack ?? DEFAULT_WEEKS_BACK;

  const summary: ActivitySyncSummary = {
    weeksProcessed: 0,
    sessionsScanned: 0,
    bookingsScanned: 0,
    metricsUpserted: 0,
    pendingWeeks: 0,
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

  let cursor = (await redis.get<ActivityCursor>(cursorKey)) ?? null;

  // Day gate (daily mode only): resume an unfinished cursor any hour, but
  // don't start a fresh sweep before the sync hour or twice in a day.
  if (!force && !cursor) {
    if (eastern.minutes < SYNC_HOUR_ET * 60) return { ...summary, skipped: 'before-sync-hour' };
    if (await redis.get(doneKey)) return { ...summary, skipped: 'already-done' };
  }

  if (!cursor) {
    const windowWeeks = [...completedWeekStarts(today, weeksBack), weekStartOf(today)];

    if (ctx.dryRun) {
      return {
        ...summary,
        wouldScan: windowWeeks.length,
        skipped: `dry-run (${windowWeeks.length} weeks from ${windowWeeks[0]})`,
      };
    }

    // Member counts are cheap and cover the whole window at once, so they run
    // up front rather than per week.
    const memberMetrics = await collectMemberMetrics(windowWeeks, today);
    summary.metricsUpserted += await upsertMetrics(db, memberMetrics, today);

    cursor = { date: today, weeks: await weeksNeedingScan(db, windowWeeks, today) };
    await redis.set(cursorKey, cursor);
  } else {
    summary.resumed = true;
    if (ctx.dryRun) {
      return { ...summary, skipped: 'dry-run (cursor pending)', pendingWeeks: cursor.weeks.length };
    }
  }

  const remaining = [...cursor.weeks];
  while (remaining.length > 0 && ctx.timeRemainingMs() > TIME_FLOOR_MS) {
    const week = remaining[0];
    if (week === undefined) break;

    const scan = await scanWeek(week, ctx);
    // Out of time mid-week: leave it pending rather than persist a partial
    // count that would read as a real drop on the dashboard.
    if (scan === null) break;

    summary.metricsUpserted += await upsertMetrics(db, scan.metrics, cursor.date);
    summary.sessionsScanned += scan.sessionsScanned;
    summary.bookingsScanned += scan.bookingsScanned;
    summary.weeksProcessed += 1;
    remaining.shift();
  }

  cursor.weeks = remaining;
  summary.pendingWeeks = remaining.length;

  if (remaining.length > 0) {
    await redis.set(cursorKey, cursor);
    return { ...summary, outOfTime: true };
  }

  await redis.del(cursorKey);
  // Keyed on the cursor's day, not today's: a resume that finishes after
  // midnight must not block the new day's sweep.
  if (!force) {
    await redis.set(
      `${prefix}:done:${cursor.date}`,
      { finishedAt: new Date().toISOString() },
      { ex: DONE_TTL_SECONDS }
    );
  }
  return summary;
}

/**
 * Which weeks need a session scan: any without attendance rows, plus the
 * last REFRESH_WEEKS weeks whose rows predate today. Newest first — the
 * dashboard's recent weeks matter most when the budget runs short.
 */
async function weeksNeedingScan(
  db: NonNullable<ReturnType<typeof getDb>>,
  weeks: string[],
  today: string
): Promise<string[]> {
  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  if (first === undefined || last === undefined) return [];

  const { data, error } = await db
    .from('business_metrics_daily')
    .select('metric_date, snapshot_date')
    .eq('metric', 'attendance')
    .gte('metric_date', first)
    .lte('metric_date', addDays(last, 6));
  if (error) throw new Error(`metric lookup failed: ${error.message}`);

  // Week → newest snapshot_date among its day rows (they're written together,
  // so any row's stamp represents the week's last scan).
  const stamped = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ metric_date: string; snapshot_date: string }>) {
    const week = weekStartOf(row.metric_date);
    const prev = stamped.get(week);
    if (prev === undefined || row.snapshot_date > prev) stamped.set(week, row.snapshot_date);
  }
  const refreshFrom = weekStartOf(addDays(today, -7 * REFRESH_WEEKS));

  return weeks
    .filter((week) => {
      const snapshotDate = stamped.get(week);
      if (snapshotDate === undefined) return true;
      return week >= refreshFrom && snapshotDate < today;
    })
    .sort()
    .reverse();
}

interface WeekScan {
  metrics: MetricUpsert[];
  sessionsScanned: number;
  bookingsScanned: number;
}

/** Per-day running counts while a week's sessions are walked. */
interface DayTally {
  capacity: number;
  booked: number;
  attended: number;
  noShows: number;
  endedSessions: number;
}

/**
 * Attendance, no-shows and occupancy inputs for one ET week, bucketed per ET
 * day. Returns null if the time budget ran out mid-scan, leaving the week for
 * the next tick.
 */
async function scanWeek(weekStart: string, ctx: CronJobContext): Promise<WeekScan | null> {
  // Momence filters on UTC instants; pad a day either side of the ET week and
  // then bucket precisely, rather than converting ET midnight to UTC here.
  const sessions = (
    await fetchHostSessions({
      startAfter: `${addDays(weekStart, -1)}T00:00:00.000Z`,
      startBefore: `${addDays(weekStart, 8)}T00:00:00.000Z`,
    })
  ).filter((session) => weekStartOf(easternDay(session.startsAt)) === weekStart);

  const now = Date.now();
  const days = new Map<string, DayTally>();
  let sessionsScanned = 0;
  let bookingsScanned = 0;

  for (const session of sessions) {
    // A session that hasn't started yet has no occupancy to report — counting
    // it would drag the in-progress day's percentage toward zero.
    if (new Date(session.startsAt).getTime() > now) continue;

    const day = easternDay(session.startsAt);
    let tally = days.get(day);
    if (!tally) {
      tally = { capacity: 0, booked: 0, attended: 0, noShows: 0, endedSessions: 0 };
      days.set(day, tally);
    }

    tally.capacity += session.capacity ?? 0;
    tally.booked += session.bookingCount ?? 0;
    sessionsScanned += 1;

    // Attendance only settles once a session is over; an empty session has no
    // bookings list worth spending a request on.
    const endsAt = session.endsAt ? new Date(session.endsAt).getTime() : null;
    if (endsAt === null || endsAt > now) continue;
    tally.endedSessions += 1;
    if ((session.bookingCount ?? 0) === 0) continue;

    if (ctx.timeRemainingMs() < TIME_FLOOR_MS) return null;

    const bookings = await fetchSessionBookings(session.id);
    bookingsScanned += bookings.length;
    for (const booking of bookings) {
      if (booking.cancelledAt) continue;
      const seats = booking.ticketsBought ?? 1;
      if (booking.checkedIn) tally.attended += seats;
      else tally.noShows += seats;
    }
  }

  const metrics: MetricUpsert[] = [];
  for (const [date, tally] of [...days.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (tally.capacity > 0) {
      metrics.push({ date, metric: 'session_capacity', value: tally.capacity });
      metrics.push({ date, metric: 'session_booked', value: tally.booked });
    }
    // Only claim attendance once at least one session has finished that day —
    // otherwise a day that is merely young reads as a day with nobody in it.
    if (tally.endedSessions > 0) {
      metrics.push({ date, metric: 'attendance', value: tally.attended });
      metrics.push({ date, metric: 'no_shows', value: tally.noShows });
    }
  }

  return { metrics, sessionsScanned, bookingsScanned };
}

/**
 * New members per ET day (from firstSeen, zero-filled through today so quiet
 * days read as 0 rather than missing) and the current active-membership
 * count. Active members is a stock with no history behind it, so it lands on
 * today only and accrues from here.
 */
async function collectMemberMetrics(weeks: string[], today: string): Promise<MetricUpsert[]> {
  const metrics: MetricUpsert[] = [];
  const windowStart = weeks[0];
  if (windowStart === undefined) return metrics;

  // Newest first, stopping at the first member who predates the window.
  const perDay = new Map<string, number>();
  let reachedWindowStart = false;
  for (let page = 0; page < MAX_MEMBER_PAGES && !reachedWindowStart; page += 1) {
    const { members } = await fetchMembersFiltered({
      page,
      pageSize: 100,
      sortBy: 'firstSeenAt',
      sortOrder: 'DESC',
    });
    if (members.length === 0) break;

    for (const member of members) {
      if (!member.firstSeen) continue;
      const day = easternDay(member.firstSeen);
      if (day < windowStart) {
        reachedWindowStart = true;
        continue;
      }
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
    if (members.length < 100) break;
  }

  for (let day = windowStart; day <= today; day = addDays(day, 1)) {
    metrics.push({ date: day, metric: 'new_members', value: perDay.get(day) ?? 0 });
  }

  const { totalCount } = await fetchMembersFiltered({
    page: 0,
    pageSize: 1,
    filterPreset: 'with-active-membership',
  });
  metrics.push({ date: today, metric: 'active_members', value: totalCount });

  return metrics;
}

async function upsertMetrics(
  db: NonNullable<ReturnType<typeof getDb>>,
  metrics: MetricUpsert[],
  snapshotDate: string
): Promise<number> {
  if (metrics.length === 0) return 0;

  const { error } = await db.from('business_metrics_daily').upsert(
    metrics.map((metric) => ({
      metric_date: metric.date,
      metric: metric.metric satisfies MetricKey,
      value: metric.value,
      source_report_type: HOST_API_SOURCE,
      snapshot_date: snapshotDate,
    })),
    { onConflict: 'metric_date,metric' }
  );
  if (error) throw new Error(`metrics upsert failed: ${error.message}`);

  return metrics.length;
}
