// Read side of /admin/business — one admin-only GET returning the business
// series over a caller-chosen date range, grouped by day, week, or month:
// Momence-sourced metrics (revenue, memberships, attendance) from
// business_metrics_daily, joined with labor cost computed live from the
// shifts tables and re-bucketed to the requested grain. Momence is never
// called on this path — the daily business-report-sync and
// business-activity-sync cron jobs keep the metrics table fresh.
//
// Alongside the buckets, the payload carries range totals for the KPI tiles
// plus the same totals for the equal-length period immediately before, so the
// tiles can show a like-for-like delta whatever range is selected. Totals are
// clamped at today: a range reaching into the future would otherwise count
// scheduled labor against revenue that hasn't happened yet.
//
// Admin-only on purpose: revenue and labor cost together are the most
// sensitive numbers in the building.

import { addDays, completedWeekStarts, utcToEastern, weekStartOf } from '@pyre/schedule-core';
import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/auth/admin';
import { computeDailyCosts } from '@/lib/business/costs';
import { type BusinessCostRow, type BusinessMetricRow, getDb } from '@/lib/db';
import { HOST_API_SOURCE } from '@/lib/reports/activity';
import { hoursSince, nextSyncAfter, SYNC_STALE_HOURS } from '@/lib/reports/schedule';
import { DAILY_REPORTS } from '@/lib/reports/sync';
import { computeDailyLabor } from '@/lib/schedule/labor';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export type BucketGroup = 'day' | 'week' | 'month';

const GROUPS: BucketGroup[] = ['day', 'week', 'month'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Span caps per grain — enough for a year of days or a couple of years of
 * coarser buckets without letting one request pull the whole table apart. */
const MAX_RANGE_DAYS: Record<BucketGroup, number> = { day: 400, week: 800, month: 1600 };

/** How far past today a range may reach (a full year's forward planning). */
const MAX_FUTURE_DAYS = 366;

/** Default window when no range is given: 8 completed weeks + the current. */
const DEFAULT_WEEKS = 8;

/** One rendered bucket: a day, a Monday-start ET week, or an ET calendar
 * month, clipped to the requested range at the edges. */
export interface BusinessBucket {
  /** First and last day actually covered (edge buckets may be partial). */
  start: string;
  end: string;
  /** null = no Momence data covers this bucket (metric-by-metric). */
  revenue: number | null;
  laborCost: number;
  openHours: number;
  revenuePerOpenHour: number | null;
  costPerOpenHour: number | null;
  laborPctOfRevenue: number | null;
  /** Admin-entered operating costs (lib/business/costs.ts): subscriptions
   * and one-off purchases; per-open-hour rent (monthly cap applied); and
   * percent-of-revenue fees on days with known revenue. */
  fixedCosts: number;
  rentCost: number;
  feesCost: number;
  /** laborCost + fixedCosts + rentCost + feesCost. */
  totalCosts: number;
  /** revenue − totalCosts; null while revenue is unknown. */
  profit: number | null;
  profitMarginPct: number | null;
  attendance: number | null;
  occupancyPct: number | null;
  noShows: number | null;
  newMembers: number | null;
  /** Latest stock value at or before the bucket's end. */
  activeMembers: number | null;
  /** Reaches today or beyond — partial numbers, rendered dimmed. */
  future: boolean;
}

/** Aggregates over one exact span of days — the KPI-tile numbers. */
export interface RangeTotals {
  start: string;
  end: string;
  revenue: number | null;
  laborCost: number;
  openHours: number;
  revenuePerOpenHour: number | null;
  costPerOpenHour: number | null;
  laborPctOfRevenue: number | null;
  fixedCosts: number;
  rentCost: number;
  feesCost: number;
  totalCosts: number;
  profit: number | null;
  profitMarginPct: number | null;
  attendance: number | null;
  occupancyPct: number | null;
  noShows: number | null;
  newMembers: number | null;
  activeMembers: number | null;
}

/**
 * How current the Momence half of the page is. Two independent daily jobs
 * feed it, so they are reported separately as well as rolled up — one of them
 * stalling leaves the other's numbers perfectly fresh, and a single timestamp
 * would hide that.
 *
 * Labor cost and open hours are deliberately absent: they are computed from
 * the shifts tables on this very request, so they are never stale.
 */
export interface SyncStatus {
  /** business-report-sync's newest snapshot — revenue. */
  reportsSyncedAt: string | null;
  /** business-activity-sync's newest write — attendance, occupancy, members. */
  activitySyncedAt: string | null;
  /** The page is only as current as its stalest feed, so: the OLDER of the
   * two above (or whichever exists). null = neither has ever run. */
  lastSyncedAt: string | null;
  /** Soonest next run across both jobs, from the cron's daily 6am ET gate. */
  nextSyncAt: string;
  /** lastSyncedAt is missing or older than SYNC_STALE_HOURS. */
  stale: boolean;
  /** Daily report types with no snapshot in the last 3 days — either the
   * type isn't available on the Momence plan or its runs keep failing. */
  missingReportTypes: string[];
}

export interface BusinessOverviewPayload {
  today: string;
  group: BucketGroup;
  start: string;
  end: string;
  buckets: BusinessBucket[];
  /** range: totals over start..min(end, today). previous: the equal-length
   * period immediately before, for deltas; null when the range is entirely
   * in the future. */
  summary: { range: RangeTotals; previous: RangeTotals | null };
  sync: SyncStatus;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Whole days in [a, b], inclusive; both YYYY-MM-DD. */
const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;

const monthStartOf = (date: string): string => `${date.slice(0, 7)}-01`;

/** Canonical start of the period containing `date` for a grain. */
function periodStartOf(date: string, group: BucketGroup): string {
  if (group === 'day') return date;
  if (group === 'week') return weekStartOf(date);
  return monthStartOf(date);
}

/** Start of the period after the one beginning at `periodStart`. */
function nextPeriodStart(periodStart: string, group: BucketGroup): string {
  if (group === 'day') return addDays(periodStart, 1);
  if (group === 'week') return addDays(periodStart, 7);
  const year = Number(periodStart.slice(0, 4));
  const month = Number(periodStart.slice(5, 7));
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const today = utcToEastern(new Date().toISOString()).date;
  const thisWeek = weekStartOf(today);

  const groupParam = url.searchParams.get('group') ?? 'week';
  if (!(GROUPS as string[]).includes(groupParam)) {
    return json({ error: `group must be one of: ${GROUPS.join(', ')}` }, 400);
  }
  const group = groupParam as BucketGroup;

  // Default range mirrors the dashboard's old fixed window: the last
  // DEFAULT_WEEKS completed weeks plus the in-progress one.
  let start = url.searchParams.get('start');
  let end = url.searchParams.get('end');
  if (start === null && end === null) {
    start = completedWeekStarts(today, DEFAULT_WEEKS)[0] ?? thisWeek;
    end = addDays(thisWeek, 6);
  }
  if (start === null || end === null || !DATE_RE.test(start) || !DATE_RE.test(end)) {
    return json({ error: 'start and end must both be YYYY-MM-DD dates' }, 400);
  }
  if (end < start) return json({ error: 'end must not be before start' }, 400);
  const spanDays = daysBetween(start, end);
  if (spanDays > MAX_RANGE_DAYS[group]) {
    return json(
      { error: `range too long: at most ${MAX_RANGE_DAYS[group]} days for group=${group}` },
      400
    );
  }
  if (end > addDays(today, MAX_FUTURE_DAYS)) {
    return json({ error: `end must be within ${MAX_FUTURE_DAYS} days of today` }, 400);
  }

  // Summary spans clamp at today; the previous period sits immediately
  // before the range with the same number of days.
  const summaryEnd = end < today ? end : today;
  const hasElapsed = summaryEnd >= start;
  const summaryDays = hasElapsed ? daysBetween(start, summaryEnd) : 0;
  const prevStart = hasElapsed ? addDays(start, -summaryDays) : start;
  const prevEnd = addDays(start, -1);

  const [metricsRes, snapshotRes, lastReportRes, lastActivityRes, costsRes, labor] =
    await Promise.all([
      db
        .from('business_metrics_daily')
        .select('*')
        .gte('metric_date', prevStart)
        .lte('metric_date', end),
      db
        .from('momence_report_snapshots')
        .select('report_type')
        .gte('snapshot_date', addDays(today, -3)),
      // Freshness reads are unbounded by date on purpose: a sync that died a
      // week ago must report as a week old, not as "never run".
      db
        .from('momence_report_snapshots')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1),
      db
        .from('business_metrics_daily')
        .select('updated_at')
        .eq('source_report_type', HOST_API_SOURCE)
        .order('updated_at', { ascending: false })
        .limit(1),
      db.from('business_costs').select('*'),
      // Labor stretches back to the top of prevStart's month — not for the
      // labor numbers themselves, but so per-open-hour rent caps accrue from
      // the first of the month (see lib/business/costs.ts).
      computeDailyLabor(db, monthStartOf(prevStart), end),
    ]);
  const queryError =
    metricsRes.error ??
    snapshotRes.error ??
    lastReportRes.error ??
    lastActivityRes.error ??
    costsRes.error;
  if (queryError) return json({ error: queryError.message }, 500);

  const metricRows = (metricsRes.data ?? []) as BusinessMetricRow[];
  const byDate = new Map<string, Map<string, number>>();
  for (const row of metricRows) {
    let day = byDate.get(row.metric_date);
    if (!day) {
      day = new Map();
      byDate.set(row.metric_date, day);
    }
    day.set(row.metric, Number(row.value));
  }
  const laborByDate = new Map(labor.map((d) => [d.date, d]));

  // Operating costs amortized per day over the same span as the metrics.
  const dailyCosts = computeDailyCosts({
    costs: (costsRes.data ?? []) as BusinessCostRow[],
    start: prevStart,
    end,
    openHoursByDate: new Map(labor.map((d) => [d.date, d.openHours])),
    revenueByDate: new Map(
      metricRows
        .filter((row) => row.metric === 'revenue_total')
        .map((row) => [row.metric_date, Number(row.value)])
    ),
  });
  const costsByDate = new Map(dailyCosts.map((d) => [d.date, d]));
  // Stock lookups: active_members observations, oldest → newest.
  const activeMemberObs = metricRows
    .filter((row) => row.metric === 'active_members')
    .map((row) => ({ date: row.metric_date, value: Number(row.value) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const latestActiveMembers = (atOrBefore: string): number | null => {
    let latest: number | null = null;
    for (const obs of activeMemberObs) {
      if (obs.date > atOrBefore) break;
      latest = obs.value;
    }
    return latest;
  };

  /** Sum flows and labor over [from, to] inclusive; nulls where no Momence
   * data covers the span at all. */
  const totalsOver = (from: string, to: string): RangeTotals => {
    let revenue: number | null = null;
    let attendance: number | null = null;
    let noShows: number | null = null;
    let newMembers: number | null = null;
    let capacity = 0;
    let booked = 0;
    let laborCost = 0;
    let openHours = 0;
    let fixedCosts = 0;
    let rentCost = 0;
    let feesCost = 0;

    for (let day = from; day <= to; day = addDays(day, 1)) {
      const metrics = byDate.get(day);
      const rev = metrics?.get('revenue_total');
      if (rev !== undefined) revenue = (revenue ?? 0) + rev;
      const att = metrics?.get('attendance');
      if (att !== undefined) attendance = (attendance ?? 0) + att;
      const ns = metrics?.get('no_shows');
      if (ns !== undefined) noShows = (noShows ?? 0) + ns;
      const nm = metrics?.get('new_members');
      if (nm !== undefined) newMembers = (newMembers ?? 0) + nm;
      capacity += metrics?.get('session_capacity') ?? 0;
      booked += metrics?.get('session_booked') ?? 0;
      const laborDay = laborByDate.get(day);
      laborCost += laborDay?.cost ?? 0;
      openHours += laborDay?.openHours ?? 0;
      const costDay = costsByDate.get(day);
      fixedCosts += costDay?.fixed ?? 0;
      rentCost += costDay?.rent ?? 0;
      feesCost += costDay?.fees ?? 0;
    }

    laborCost = round2(laborCost);
    openHours = Math.round(openHours * 10) / 10;
    if (revenue !== null) revenue = round2(revenue);
    fixedCosts = round2(fixedCosts);
    rentCost = round2(rentCost);
    feesCost = round2(feesCost);
    const totalCosts = round2(laborCost + fixedCosts + rentCost + feesCost);
    const profit = revenue !== null ? round2(revenue - totalCosts) : null;
    return {
      start: from,
      end: to,
      revenue,
      laborCost,
      openHours,
      revenuePerOpenHour: revenue !== null && openHours > 0 ? round2(revenue / openHours) : null,
      costPerOpenHour: openHours > 0 ? round2(laborCost / openHours) : null,
      laborPctOfRevenue:
        revenue !== null && revenue > 0 ? round2((laborCost / revenue) * 100) : null,
      fixedCosts,
      rentCost,
      feesCost,
      totalCosts,
      profit,
      profitMarginPct:
        revenue !== null && revenue > 0 && profit !== null
          ? round2((profit / revenue) * 100)
          : null,
      attendance,
      occupancyPct: capacity > 0 ? round2((booked / capacity) * 100) : null,
      noShows,
      newMembers,
      activeMembers: latestActiveMembers(to),
    };
  };

  // Buckets tile the requested range; the first and last may be clipped
  // (e.g. a quarter grouped by week starts mid-week).
  const buckets: BusinessBucket[] = [];
  for (let cursor = start; cursor <= end; ) {
    const periodStart = periodStartOf(cursor, group);
    const next = nextPeriodStart(periodStart, group);
    const bucketEnd = addDays(next, -1) < end ? addDays(next, -1) : end;
    const t = totalsOver(cursor, bucketEnd);
    buckets.push({
      start: cursor,
      end: bucketEnd,
      revenue: t.revenue,
      laborCost: t.laborCost,
      openHours: t.openHours,
      revenuePerOpenHour: t.revenuePerOpenHour,
      costPerOpenHour: t.costPerOpenHour,
      laborPctOfRevenue: t.laborPctOfRevenue,
      fixedCosts: t.fixedCosts,
      rentCost: t.rentCost,
      feesCost: t.feesCost,
      totalCosts: t.totalCosts,
      profit: t.profit,
      profitMarginPct: t.profitMarginPct,
      attendance: t.attendance,
      occupancyPct: t.occupancyPct,
      noShows: t.noShows,
      newMembers: t.newMembers,
      activeMembers: t.activeMembers,
      future: bucketEnd >= today,
    });
    cursor = next;
  }

  const emptyTotals: RangeTotals = {
    ...totalsOver(start, start),
    start,
    end: start,
    revenue: null,
    laborCost: 0,
    openHours: 0,
    revenuePerOpenHour: null,
    costPerOpenHour: null,
    laborPctOfRevenue: null,
    fixedCosts: 0,
    rentCost: 0,
    feesCost: 0,
    totalCosts: 0,
    profit: null,
    profitMarginPct: null,
    attendance: null,
    occupancyPct: null,
    noShows: null,
    newMembers: null,
  };
  const summary = {
    range: hasElapsed ? totalsOver(start, summaryEnd) : emptyTotals,
    previous: hasElapsed ? totalsOver(prevStart, prevEnd) : null,
  };

  const seenTypes = new Set(
    ((snapshotRes.data ?? []) as Array<{ report_type: string }>).map((s) => s.report_type)
  );
  // PostgREST renders timestamptz as '…+00:00' with however many fractional
  // digits Postgres kept, so canonicalize on the way in: one format for the
  // comparisons below and for the <time datetime> the client emits.
  const isoOrNull = (t: string | undefined): string | null =>
    t === undefined ? null : new Date(t).toISOString();

  const reportsSyncedAt = isoOrNull(
    ((lastReportRes.data ?? []) as Array<{ created_at: string }>)[0]?.created_at
  );
  const activitySyncedAt = isoOrNull(
    ((lastActivityRes.data ?? []) as Array<{ updated_at: string }>)[0]?.updated_at
  );

  // Roll up to the stalest feed that has ever run: if one job has never
  // written at all its metrics are simply absent from the charts (and
  // missingReportTypes calls that out), so it must not drag the timestamp of
  // the data that IS on screen back to "never".
  // Canonical ISO-8601 Z strings share a format and length, so lexical order
  // is chronological order — min needs no re-parsing.
  const earliest = (a: string, b: string): string => (a < b ? a : b);
  const lastSyncedAt = [reportsSyncedAt, activitySyncedAt]
    .filter((t): t is string => t !== null)
    .reduce<string | null>((a, b) => (a === null ? b : earliest(a, b)), null);

  const nowIso = new Date().toISOString();
  const sync: SyncStatus = {
    reportsSyncedAt,
    activitySyncedAt,
    lastSyncedAt,
    // Soonest of the two: reports finishing for the day must not hide an
    // activity sweep that is still due within the hour.
    nextSyncAt: [reportsSyncedAt, activitySyncedAt]
      .map((at) => nextSyncAfter(nowIso, at))
      .reduce(earliest),
    stale: hoursSince(nowIso, lastSyncedAt) > SYNC_STALE_HOURS,
    missingReportTypes: DAILY_REPORTS.filter((t) => !seenTypes.has(t)),
  };

  const payload: BusinessOverviewPayload = {
    today,
    group,
    start,
    end,
    buckets,
    summary,
    sync,
  };

  return json(payload);
};
