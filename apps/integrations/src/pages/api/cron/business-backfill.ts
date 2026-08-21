import type { APIRoute } from 'astro';
import { isCronAuthorized, unauthorizedResponse } from '@/lib/cron/auth';
import { runActivityMetricsSync } from '@/lib/reports/activity';
import { runBusinessReportSync } from '@/lib/reports/sync';

export const prerender = false;

// One-off historical pull for /admin/business — same machinery as the daily
// business-report-sync job, but with a caller-chosen window and its own
// cursor namespace so it never collides with the daily state. Manual use:
//
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     "https://<integrations>/api/cron/business-backfill?weeks=26&dryRun=1"
//   curl ... "/api/cron/business-backfill?weeks=26"      # create + poll
//   curl ... "/api/cron/business-backfill"               # poll again if runs
//                                                        # were still pending
//
// Re-curling after completion creates a fresh report run (one create against
// the 100/day budget), so run it until both `pendingTypes` and
// `activity.pendingWeeks` clear, then stop. Metric upserts are idempotent.
//
// Note: point-in-time counts (active members) can't be reconstructed for the
// past — backfill fills flow metrics; stocks accrue from daily syncs onward.

const BUDGET_MS = 50_000;
const MAX_WEEKS = 52;

const handler: APIRoute = async ({ request, url }) => {
  if (!isCronAuthorized(request)) return unauthorizedResponse();

  const started = Date.now();
  const weeksParam = url.searchParams.get('weeks');
  const weeks = weeksParam === null ? 26 : Number(weeksParam);
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_WEEKS) {
    return new Response(
      JSON.stringify({ error: `weeks must be an integer between 1 and ${MAX_WEEKS}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const ctx = {
    dryRun: url.searchParams.get('dryRun') === '1',
    timeRemainingMs: () => BUDGET_MS - (Date.now() - started),
  };

  const reports = await runBusinessReportSync(ctx, {
    weeksBack: weeks,
    force: true,
    redisPrefix: 'report-sync:backfill',
  });

  // Session scanning is the slow half and shares this request's budget, so a
  // wide backfill needs several curls before `activity.pendingWeeks` is 0.
  const activity = await runActivityMetricsSync(ctx, {
    weeksBack: weeks,
    force: true,
    redisPrefix: 'activity-sync:backfill',
  });

  return new Response(JSON.stringify({ weeks, ...reports, activity }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const GET = handler;
export const POST = handler;
