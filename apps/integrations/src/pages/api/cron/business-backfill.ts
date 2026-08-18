import type { APIRoute } from 'astro';
import { isCronAuthorized, unauthorizedResponse } from '@/lib/cron/auth';
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
// Re-curling after completion creates a fresh batch of report runs (each
// batch is one create per report type against the 100/day budget), so run it
// until pending clears and then stop. Weekly upserts are idempotent.
//
// Note: point-in-time reports (active members) can't be reconstructed for the
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

  const summary = await runBusinessReportSync(
    {
      dryRun: url.searchParams.get('dryRun') === '1',
      timeRemainingMs: () => BUDGET_MS - (Date.now() - started),
    },
    { weeksBack: weeks, force: true, redisPrefix: 'report-sync:backfill' }
  );

  return new Response(JSON.stringify({ weeks, ...summary }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const GET = handler;
export const POST = handler;
