// Read side of /admin/business — one admin-only GET returning the weekly
// business series: Momence-sourced metrics (revenue, memberships,
// attendance) from business_metrics_weekly, joined with labor cost computed
// live from the shifts tables. Momence is never called on this path — the
// daily business-report-sync cron job keeps the metrics tables fresh.
//
// Admin-only on purpose: revenue and labor cost together are the most
// sensitive numbers in the building.

import { addDays, completedWeekStarts, utcToEastern, weekStartOf } from '@pyre/schedule-core';
import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/auth/admin';
import { type BusinessMetricRow, getDb } from '@/lib/db';
import { DAILY_REPORTS } from '@/lib/reports/sync';
import { computeWeeklyLabor } from '@/lib/schedule/labor';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const DEFAULT_WEEKS = 8;
const MIN_WEEKS = 1;
const MAX_WEEKS = 26;

export interface BusinessWeek {
  weekStart: string;
  /** null = no Momence snapshot covers this week (metric-by-metric). */
  revenue: number | null;
  laborCost: number;
  openHours: number;
  revenuePerOpenHour: number | null;
  costPerOpenHour: number | null;
  laborPctOfRevenue: number | null;
  attendance: number | null;
  occupancyPct: number | null;
  noShows: number | null;
  newMembers: number | null;
  cancellations: number | null;
  /** End-of-week stock, from the latest snapshot covering the week. */
  activeMembers: number | null;
  /** Current week — partial numbers. */
  future: boolean;
}

export interface BusinessOverviewPayload {
  today: string;
  weeks: BusinessWeek[];
  /** Newest snapshot write; stale (>26h) means the sync job is unwell. */
  lastSyncedAt: string | null;
  /** Daily report types with no snapshot in the last 3 days — either the
   * type isn't available on the Momence plan or its runs keep failing. */
  missingReportTypes: string[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const weeksParam = url.searchParams.get('weeks');
  const weeks = weeksParam === null ? DEFAULT_WEEKS : Number(weeksParam);
  if (!Number.isInteger(weeks) || weeks < MIN_WEEKS || weeks > MAX_WEEKS) {
    return json({ error: `weeks must be an integer between ${MIN_WEEKS} and ${MAX_WEEKS}` }, 400);
  }

  const today = utcToEastern(new Date().toISOString()).date;
  const thisWeek = weekStartOf(today);
  // Last N completed weeks plus the in-progress one (rendered as partial).
  const weekStarts = [...completedWeekStarts(today, weeks), thisWeek];
  const rangeStart = weekStarts[0];
  const rangeEnd = addDays(thisWeek, 6);

  const [metricsRes, snapshotRes, labor] = await Promise.all([
    db
      .from('business_metrics_weekly')
      .select('*')
      .gte('week_start', rangeStart)
      .lte('week_start', thisWeek),
    db
      .from('momence_report_snapshots')
      .select('report_type, snapshot_date, created_at')
      .gte('snapshot_date', addDays(today, -3)),
    computeWeeklyLabor(db, rangeStart, rangeEnd),
  ]);
  const queryError = metricsRes.error ?? snapshotRes.error;
  if (queryError) return json({ error: queryError.message }, 500);

  const metricRows = (metricsRes.data ?? []) as BusinessMetricRow[];
  const byWeek = new Map<string, Map<string, number>>();
  for (const row of metricRows) {
    let week = byWeek.get(row.week_start);
    if (!week) {
      week = new Map();
      byWeek.set(row.week_start, week);
    }
    week.set(row.metric, Number(row.value));
  }
  const laborByWeek = new Map(labor.map((w) => [w.weekStart, w]));

  const weeksOut: BusinessWeek[] = weekStarts.map((weekStart) => {
    const metrics = byWeek.get(weekStart);
    const laborWeek = laborByWeek.get(weekStart);
    const revenue = metrics?.get('revenue_total') ?? null;
    const laborCost = laborWeek?.cost ?? 0;
    const openHours = laborWeek?.openHours ?? 0;
    return {
      weekStart,
      revenue,
      laborCost,
      openHours,
      revenuePerOpenHour: revenue !== null && openHours > 0 ? round2(revenue / openHours) : null,
      costPerOpenHour: laborWeek?.costPerOpenHour ?? null,
      laborPctOfRevenue:
        revenue !== null && revenue > 0 ? round2((laborCost / revenue) * 100) : null,
      attendance: metrics?.get('attendance') ?? null,
      occupancyPct: metrics?.get('occupancy_pct') ?? null,
      noShows: metrics?.get('no_shows') ?? null,
      newMembers: metrics?.get('new_members') ?? null,
      cancellations: metrics?.get('membership_cancellations') ?? null,
      activeMembers: metrics?.get('active_members') ?? null,
      future: weekStart >= thisWeek,
    };
  });

  const snapshots = (snapshotRes.data ?? []) as Array<{
    report_type: string;
    snapshot_date: string;
    created_at: string;
  }>;
  const seenTypes = new Set(snapshots.map((s) => s.report_type));
  const lastSyncedAt =
    snapshots.length > 0 ? snapshots.map((s) => s.created_at).sort()[snapshots.length - 1] : null;

  const payload: BusinessOverviewPayload = {
    today,
    weeks: weeksOut,
    lastSyncedAt,
    missingReportTypes: DAILY_REPORTS.filter((t) => !seenTypes.has(t)),
  };

  return json(payload);
};
