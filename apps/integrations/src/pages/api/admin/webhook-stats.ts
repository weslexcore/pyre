// Webhook health stats for the admin dashboard, ported from the landing-page
// admin. Day-level trends come from durable Redis counters; percentiles and
// the failure list come from the live execution records.

import {
  backfillDailyStats,
  getDailyStats,
  getExecutionSummariesSince,
  type WebhookExecutionSummary,
} from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import { requirePage } from '@/lib/auth/admin';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_DAYS = 7;
const MAX_DAYS = 90;
const MAX_RECENT_FAILURES = 10;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function summarizeLast24h(records: WebhookExecutionSummary[]) {
  const durations = records
    .map((r) => r.durationMs)
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  const errors = records.filter((r) => r.status === 'error').length;

  return {
    total: records.length,
    errors,
    errorRate: records.length > 0 ? errors / records.length : 0,
    p50DurationMs: percentile(durations, 50),
    p95DurationMs: percentile(durations, 95),
  };
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, '/admin/webhooks');
  if (gate instanceof Response) return gate;

  const daysRaw = Number.parseInt(url.searchParams.get('days') ?? '', 10);
  const days = Number.isNaN(daysRaw) ? 30 : Math.min(MAX_DAYS, Math.max(MIN_DAYS, daysRaw));

  try {
    const now = Date.now();

    // Last 7 days of slim records powers percentiles + the failure list; the
    // 24h subset is derived from the same fetch.
    const recent = await getExecutionSummariesSince(now - 7 * DAY_MS);

    // One-time replay of everything still in the 14-day execution store into
    // the durable day counters (no-ops via a Redis flag after the first run).
    await backfillDailyStats(() => getExecutionSummariesSince(0, 2000));

    const dailyStats = await getDailyStats(days);

    const last24hRecords = recent.filter((r) => r.timestamp >= now - DAY_MS);
    const recentFailures = recent
      .filter((r) => r.status === 'error')
      .slice(0, MAX_RECENT_FAILURES)
      .map(({ id, timestamp, eventType, source, httpStatus, errorMessage, durationMs }) => ({
        id,
        timestamp,
        eventType,
        source,
        httpStatus,
        errorMessage,
        durationMs,
      }));

    return new Response(
      JSON.stringify({
        generatedAt: new Date(now).toISOString(),
        days: dailyStats,
        last24h: summarizeLast24h(last24hRecords),
        recentFailures,
      }),
      { status: 200, headers: JSON_HEADERS }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
};
