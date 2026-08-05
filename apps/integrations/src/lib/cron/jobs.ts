// The cron job registry. A single hourly QStash schedule hits /api/cron/tick,
// which runs every registered job sequentially inside a shared time budget —
// one schedule entry, one code path for staggering and dry runs.
//
// Job contract: read the world (Momence is the source of truth), decide, act
// idempotently (send-log claims / redis cursors make repeat runs no-ops), and
// return a small summary object for the tick response. A job that overruns the
// budget should persist a resumable cursor (`sweep:{name}:cursor` in redis) and
// pick up on the next tick.

export interface CronJobContext {
  /** When true, report what WOULD happen without sending or writing state. */
  dryRun: boolean;
  /** Deadline check — jobs should stop cleanly (persisting cursors) when out of time. */
  timeRemainingMs(): number;
}

export interface CronJob {
  name: string;
  run(ctx: CronJobContext): Promise<Record<string, unknown>>;
}

// Lazy imports keep the webhook routes' cold starts free of engine code — the
// registry is only materialized when the cron tick runs.
export const CRON_JOBS: CronJob[] = [
  {
    // Purchases first: they can enroll members whose steps then advance below.
    name: 'sales-poll',
    run: async (ctx) => (await import('@/lib/triggers/sales-poll')).runSalesPoll(ctx),
  },
  {
    name: 'journey-sweeps',
    run: async (ctx) => (await import('@/lib/email/journeys/engine')).runEnrollmentSweeps(ctx),
  },
  {
    name: 'journey-advance',
    run: async (ctx) => (await import('@/lib/email/journeys/engine')).advanceDueJourneys(ctx),
  },
  {
    name: 'credit-reminders',
    run: async (ctx) =>
      (await import('@/lib/email/triggers/credit-reminders')).runCreditReminders(ctx),
  },
  {
    // Partner verification upkeep: expire stale requests, quarterly
    // reconciliation email (send_key-gated, so hourly runs are no-ops).
    name: 'partner-maintenance',
    run: async (ctx) => (await import('@/lib/partner/verification')).runPartnerMaintenance(ctx),
  },
  {
    // Momence → shifts coverage-window sync for staff scheduling. Idempotent;
    // never touches sync_locked/staffed shifts beyond flagging them.
    name: 'sync-shifts',
    run: async (ctx) => {
      const summary = await (await import('@/lib/schedule/sync')).syncShifts({
        dryRun: ctx.dryRun,
      });
      return summary as unknown as Record<string, unknown>;
    },
  },
];
