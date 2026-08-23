// "Sync now" behind /admin/business: run today's Momence pull on demand
// instead of waiting for the 6am ET cron gate.
//
// Same two jobs the hourly tick runs, forced past their day gate and sharing
// the daily cursor namespace on purpose — a click should RESUME work the cron
// parked, not start a rival sweep beside it. Unlike the cron path it does not
// set the done-key, so the day's scheduled run still happens.
//
// Report-run creation spends a 100/day Momence budget, so a Redis lock makes
// this one-at-a-time and adds a cooldown: a double-click, two admins, or an
// impatient tab must not burn the budget or run two sweeps over each other.
//
// Admin-only, and a mutation on a cookie-authed route — hence the same-origin
// and JSON content-type checks (see astro.config.mjs on why CSRF is defended
// in-route here).

import { getRedis } from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import { assertSameOrigin, requireAdmin } from '@/lib/auth/admin';
import { type ActivitySyncSummary, runActivityMetricsSync } from '@/lib/reports/activity';
import { type ReportSyncSummary, runBusinessReportSync } from '@/lib/reports/sync';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** Leave headroom under the function's 60s maxDuration (astro.config.mjs), the
 * same way the cron tick does — whatever doesn't finish parks in the cursor. */
const BUDGET_MS = 45_000;

const LOCK_KEY = 'business-sync:manual';

/** Held across the run, then left to expire as the cooldown. Long enough that
 * a full-budget run plus a pause is covered by one key. */
const LOCK_TTL_SECONDS = 90;

export interface BusinessSyncResponse {
  /** One line for the admin who pressed the button. */
  message: string;
  /** True when either job parked work for a later run. */
  pending: boolean;
  reports: ReportSyncSummary;
  activity: ActivitySyncSummary;
}

/** Plain-language outcome, so the dashboard doesn't have to know job internals. */
function describe(reports: ReportSyncSummary, activity: ActivitySyncSummary): string {
  const parts: string[] = [];

  if (reports.skipped) parts.push(`revenue skipped (${reports.skipped})`);
  else if (reports.completed > 0) parts.push(`revenue updated`);
  else if (reports.outOfTime) parts.push(`revenue report still running`);

  if (reports.failedTypes.length > 0) {
    parts.push(`revenue report failed: ${reports.failedTypes.join(', ')}`);
  }

  if (activity.skipped) parts.push(`activity skipped (${activity.skipped})`);
  else {
    const done: string[] = [];
    if (activity.membersClassified > 0) done.push(`${activity.membersClassified} members`);
    if (activity.weeksProcessed > 0) done.push(`${activity.weeksProcessed} weeks`);
    if (done.length > 0) parts.push(`activity: ${done.join(', ')}`);
    else if (!activity.outOfTime) parts.push('activity already current');
  }

  const pendingBits: string[] = [];
  if (activity.pendingWeeks > 0) pendingBits.push(`${activity.pendingWeeks} weeks`);
  if (activity.pendingMembers > 0) pendingBits.push(`${activity.pendingMembers} members`);
  if (reports.pendingTypes && reports.pendingTypes.length > 0)
    pendingBits.push('the revenue report');

  const summary = parts.length > 0 ? parts.join(' · ') : 'nothing to update';
  return pendingBits.length > 0
    ? `${summary}. Still pending: ${pendingBits.join(', ')} — press again or wait for the next sync.`
    : `${summary}.`;
}

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  // No body is read, but the content-type requirement is what stops a
  // cross-origin form POST from reaching this route at all.
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }

  const redis = getRedis();
  if (!redis) return json({ error: 'Sync state unavailable (no Redis)' }, 503);

  const claimed = await redis.set(LOCK_KEY, new Date().toISOString(), {
    nx: true,
    ex: LOCK_TTL_SECONDS,
  });
  if (claimed === null) {
    return json(
      {
        error: 'A sync is already running or just finished — give it a minute.',
        retryAfterSeconds: LOCK_TTL_SECONDS,
      },
      429
    );
  }

  const started = Date.now();
  const ctx = { dryRun: false, timeRemainingMs: () => BUDGET_MS - (Date.now() - started) };

  try {
    // Reports first: it creates the run and then polls, so giving it the front
    // of the budget is what lets a run complete inside one press.
    const reports = await runBusinessReportSync(ctx, { force: true });
    const activity = await runActivityMetricsSync(ctx, { force: true });

    const body: BusinessSyncResponse = {
      message: describe(reports, activity),
      pending: Boolean(reports.outOfTime || activity.outOfTime),
      reports,
      activity,
    };
    return json(body);
  } catch (error) {
    console.error('[business-sync] manual run failed:', error);
    // Free the lock: a crashed run left nothing worth protecting, and making
    // the admin wait out the cooldown to retry a failure is just cruel.
    await redis.del(LOCK_KEY);
    return json({ error: error instanceof Error ? error.message : 'Sync failed' }, 500);
  }
};
