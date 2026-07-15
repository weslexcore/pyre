import type { APIRoute } from 'astro';
import { isCronAuthorized, unauthorizedResponse } from '@/lib/cron/auth';
import { CRON_JOBS, type CronJobContext } from '@/lib/cron/jobs';

export const prerender = false;

// The single hourly cron entry point. Triggered by an Upstash QStash schedule
// (cron "0 * * * *", POST, with an `Upstash-Forward-Authorization: Bearer
// $CRON_SECRET` header) — Vercel's own crons need the Pro plan, QStash's are
// free and we already run Upstash. Manual testing:
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     "https://<integrations>/api/cron/tick?dryRun=1"        # all jobs, no writes
//   curl ... "/api/cron/tick?job=journey-advance"            # a single job

// Leave headroom under the function's max duration so we always return a
// response (jobs persist cursors and resume next tick).
const TIME_BUDGET_MS = 50_000;

const handler: APIRoute = async ({ request, url }) => {
  if (!isCronAuthorized(request)) return unauthorizedResponse();

  const started = Date.now();
  const dryRun = url.searchParams.get('dryRun') === '1';
  const only = url.searchParams.get('job');

  // Manual test enrollment (whitelist testing with JOURNEY_FAST_MODE):
  //   /api/cron/tick?enroll=<memberId>&journey=<journeyId>
  const enrollMemberId = url.searchParams.get('enroll');
  const enrollJourneyId = url.searchParams.get('journey');
  if (enrollMemberId && enrollJourneyId) {
    const [{ enrollMember }, { JOURNEYS }, { fetchHostMember }] = await Promise.all([
      import('@/lib/email/journeys/engine'),
      import('@/lib/email/journeys/registry'),
      import('@/lib/momence/host-api'),
    ]);
    const journey = JOURNEYS.find((j) => j.id === enrollJourneyId);
    if (!journey) {
      return new Response(
        JSON.stringify({
          error: `Unknown journey '${enrollJourneyId}'`,
          known: JOURNEYS.map((j) => j.id),
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const member = await fetchHostMember(Number.parseInt(enrollMemberId, 10));
    const outcome = await enrollMember(journey, {
      memberId: member.id,
      email: member.email,
      firstName: member.firstName,
      lastName: member.lastName,
    });
    return new Response(JSON.stringify({ enrolled: member.email, journey: journey.id, outcome }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const jobs = only ? CRON_JOBS.filter((j) => j.name === only) : CRON_JOBS;
  if (only && jobs.length === 0) {
    return new Response(
      JSON.stringify({ error: `Unknown job '${only}'`, known: CRON_JOBS.map((j) => j.name) }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const ctx: CronJobContext = {
    dryRun,
    timeRemainingMs: () => TIME_BUDGET_MS - (Date.now() - started),
  };

  const results: Record<string, unknown> = {};

  for (const job of jobs) {
    if (ctx.timeRemainingMs() <= 0) {
      results[job.name] = { skipped: 'out-of-time' };
      continue;
    }
    const jobStart = Date.now();
    try {
      const summary = await job.run(ctx);
      results[job.name] = { ...summary, durationMs: Date.now() - jobStart };
    } catch (error) {
      console.error(`[Cron] Job ${job.name} failed`, error);
      results[job.name] = {
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - jobStart,
      };
    }
  }

  return new Response(
    JSON.stringify({ dryRun, jobs: results, totalDurationMs: Date.now() - started }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};

// GET for manual curl testing, POST for QStash (its default publish method).
export const GET = handler;
export const POST = handler;
