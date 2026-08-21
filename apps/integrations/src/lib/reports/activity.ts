// The second half of /admin/business: the metrics Momence's report API
// cannot produce.
//
// POST /host/reports only knows `total-sales` (see MomenceReportType), so
// attendance, no-shows, occupancy and membership counts have to be derived
// from the host endpoints that do carry them:
//
//   attendance      /host/sessions/{id}/bookings → checkedIn, ticketsBought
//   no_shows        the same list, minus check-ins and cancellations
//   occupancy_pct   /host/sessions → bookingCount / capacity
//   new_members     /host/members sorted by firstSeenAt
//   active_members  /host/members/list with filterPreset=with-active-membership
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
// Weeks are Monday-start ET wall-clock. Momence timestamps are UTC instants,
// so every one is converted before bucketing.

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

/** Provenance stamp on rows this sweep writes (vs a report type). */
const SOURCE = 'HOST_API';

/** ET hour from which the daily sweep may start. */
const SYNC_HOUR_ET = 6;

/** Trailing window: this many weeks back from the current Monday. */
const DEFAULT_WEEKS_BACK = 12;

/**
 * How many *completed* weeks back stay in the daily re-scan, on top of the
 * in-progress one — a late check-in or a cancellation keeps changing them.
 * Older weeks are settled and are only scanned if their row is missing.
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
 * Which weeks need a session scan: any without an attendance row, plus the
 * last REFRESH_WEEKS weeks whose row predates today. Newest first — the
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
    .from('business_metrics_weekly')
    .select('week_start, snapshot_date')
    .eq('metric', 'attendance')
    .gte('week_start', first)
    .lte('week_start', last);
  if (error) throw new Error(`metric lookup failed: ${error.message}`);

  const stamped = new Map(
    (data ?? []).map((row) => [row.week_start as string, row.snapshot_date as string])
  );
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

/**
 * Attendance, no-shows and occupancy for one ET week. Returns null if the
 * time budget ran out mid-scan, leaving the week for the next tick.
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
  let capacity = 0;
  let booked = 0;
  let attended = 0;
  let noShows = 0;
  let sessionsScanned = 0;
  let bookingsScanned = 0;
  let endedSessions = 0;

  for (const session of sessions) {
    // A session that hasn't started yet has no occupancy to report — counting
    // it would drag the in-progress week's percentage toward zero.
    if (new Date(session.startsAt).getTime() > now) continue;

    capacity += session.capacity ?? 0;
    booked += session.bookingCount ?? 0;
    sessionsScanned += 1;

    // Attendance only settles once a session is over; an empty session has no
    // bookings list worth spending a request on.
    const endsAt = session.endsAt ? new Date(session.endsAt).getTime() : null;
    if (endsAt === null || endsAt > now) continue;
    endedSessions += 1;
    if ((session.bookingCount ?? 0) === 0) continue;

    if (ctx.timeRemainingMs() < TIME_FLOOR_MS) return null;

    const bookings = await fetchSessionBookings(session.id);
    bookingsScanned += bookings.length;
    for (const booking of bookings) {
      if (booking.cancelledAt) continue;
      const seats = booking.ticketsBought ?? 1;
      if (booking.checkedIn) attended += seats;
      else noShows += seats;
    }
  }

  const metrics: MetricUpsert[] = [];
  if (capacity > 0) {
    metrics.push({
      weekStart,
      metric: 'occupancy_pct',
      value: Math.round((booked / capacity) * 100 * 100) / 100,
    });
  }
  // Only claim attendance once at least one session has finished — otherwise
  // a week that is merely young reads as a week with nobody in it.
  if (endedSessions > 0) {
    metrics.push({ weekStart, metric: 'attendance', value: attended });
    metrics.push({ weekStart, metric: 'no_shows', value: noShows });
  }

  return { metrics, sessionsScanned, bookingsScanned };
}

/**
 * New members per week (from firstSeen) and the current active-membership
 * count. Active members is a stock with no history behind it, so it lands on
 * the current week only and accrues from here.
 */
async function collectMemberMetrics(weeks: string[], today: string): Promise<MetricUpsert[]> {
  const metrics: MetricUpsert[] = [];
  const windowStart = weeks[0];
  if (windowStart === undefined) return metrics;

  // Newest first, stopping at the first member who predates the window.
  const perWeek = new Map<string, number>();
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
      const week = weekStartOf(day);
      perWeek.set(week, (perWeek.get(week) ?? 0) + 1);
    }
    if (members.length < 100) break;
  }

  for (const week of weeks) {
    metrics.push({ weekStart: week, metric: 'new_members', value: perWeek.get(week) ?? 0 });
  }

  const { totalCount } = await fetchMembersFiltered({
    page: 0,
    pageSize: 1,
    filterPreset: 'with-active-membership',
  });
  metrics.push({ weekStart: weekStartOf(today), metric: 'active_members', value: totalCount });

  return metrics;
}

async function upsertMetrics(
  db: NonNullable<ReturnType<typeof getDb>>,
  metrics: MetricUpsert[],
  snapshotDate: string
): Promise<number> {
  if (metrics.length === 0) return 0;

  const { error } = await db.from('business_metrics_weekly').upsert(
    metrics.map((metric) => ({
      week_start: metric.weekStart,
      metric: metric.metric satisfies MetricKey,
      value: metric.value,
      source_report_type: SOURCE,
      snapshot_date: snapshotDate,
    })),
    { onConflict: 'week_start,metric' }
  );
  if (error) throw new Error(`metrics upsert failed: ${error.message}`);

  return metrics.length;
}
