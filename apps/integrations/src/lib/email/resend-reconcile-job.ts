import { utcToEastern } from '@pyre/schedule-core';
import { getRedis } from '@pyre/webhook-core';
import type { CronJobContext } from '@/lib/cron/jobs';
import { getDb } from '@/lib/db';
import { getResend } from './resend';
import {
  createPacer,
  emptyTally,
  fetchContactPage,
  loadSuppressedEmails,
  reconcileContacts,
} from './resend-sync';
import { suppressEmail } from './suppression';

// Daily pass that brings Resend's contact flags into line with
// email_suppressions (see ./resend-sync.ts for why both directions matter).
// Runs on the first tick at or after 4am ET. Resend pages 100 contacts per
// call at about 2 calls a second, so a big list can outlast the tick's shared
// budget: the page cursor is kept in Redis and the next tick carries on.

export const RECONCILE_HOUR_ET = 4;
const CURSOR_KEY = 'sweep:resend-reconcile:cursor';
const DONE_PREFIX = 'resend-reconcile:done:';
const DONE_TTL_SECONDS = 3 * 24 * 60 * 60;
/** Stop starting new pages with less than this left, so the tick can finish. */
const RESERVE_MS = 12_000;
/** Addresses listed in the summary; the counts are always complete. */
const SAMPLE = 20;

export interface ResendReconcileSummary {
  trigger: 'daily' | 'resume' | 'forced' | 'dry-run';
  skipped?: string;
  pages: number;
  scanned: number;
  markedUnsubscribed: number;
  newSuppressions: number;
  sample?: { markedUnsubscribed: string[]; newSuppressions: string[] };
  errors: string[];
  finished: boolean;
}

export async function runResendReconcile(ctx: CronJobContext): Promise<ResendReconcileSummary> {
  const eastern = utcToEastern(new Date().toISOString());
  const doneKey = `${DONE_PREFIX}${eastern.date}`;
  const summary: ResendReconcileSummary = {
    trigger: ctx.dryRun ? 'dry-run' : ctx.force ? 'forced' : 'daily',
    pages: 0,
    scanned: 0,
    markedUnsubscribed: 0,
    newSuppressions: 0,
    errors: [],
    finished: false,
  };

  const resend = getResend();
  const db = getDb();
  if (!resend) return { ...summary, skipped: 'resend-not-configured' };
  if (!db) return { ...summary, skipped: 'no-db' };

  const redis = getRedis();
  let cursor: string | null = null;
  if (!ctx.dryRun) {
    // Without Redis there is no day gate or cursor; an hourly full pass would
    // spend the Resend rate limit the journeys need.
    if (!redis) return { ...summary, skipped: 'redis-unavailable' };
    cursor = await redis.get<string>(CURSOR_KEY);
    if (cursor) {
      summary.trigger = 'resume';
    } else if (!ctx.force) {
      if (eastern.minutes < RECONCILE_HOUR_ET * 60) return { ...summary, skipped: 'before-hour' };
      if (await redis.get(doneKey)) return { ...summary, skipped: 'already-done' };
    }
  }

  const suppressed = await loadSuppressedEmails(db);
  const pace = createPacer();
  const tally = emptyTally();
  const deps = {
    resend,
    pace,
    suppressed,
    dryRun: ctx.dryRun,
    suppress: (email: string) =>
      suppressEmail({ email, reason: 'unsubscribe', source: 'resend-reconcile' }),
  };

  let next: string | null = cursor;
  let outOfTime = false;
  do {
    if (ctx.timeRemainingMs() < RESERVE_MS) {
      outOfTime = true;
      break;
    }
    let page: Awaited<ReturnType<typeof fetchContactPage>>;
    try {
      page = await fetchContactPage(resend, pace, { after: next });
    } catch (error) {
      // A saved cursor can go stale (its contact deleted). Drop it so the next
      // tick starts over instead of failing on it every hour.
      if (next && next === cursor && redis && !ctx.dryRun) await redis.del(CURSOR_KEY);
      throw error;
    }
    await reconcileContacts(page.contacts, deps, tally);
    summary.pages++;
    next = page.next;
  } while (next);

  summary.finished = !outOfTime && next === null;
  summary.scanned = tally.scanned;
  summary.markedUnsubscribed = tally.markedUnsubscribed.length;
  summary.newSuppressions = tally.newSuppressions.length;
  summary.errors = tally.errors.slice(0, SAMPLE);
  if (tally.markedUnsubscribed.length > 0 || tally.newSuppressions.length > 0) {
    summary.sample = {
      markedUnsubscribed: tally.markedUnsubscribed.slice(0, SAMPLE),
      newSuppressions: tally.newSuppressions.slice(0, SAMPLE),
    };
  }

  if (!ctx.dryRun && redis) {
    if (summary.finished) {
      await redis.set(doneKey, { finishedAt: new Date().toISOString() }, { ex: DONE_TTL_SECONDS });
      await redis.del(CURSOR_KEY);
    } else if (next) {
      // Ran out of time with a page to go: the next tick carries on from it.
      // (Out of time before the first page leaves the cursor as it was.)
      await redis.set(CURSOR_KEY, next);
    }
  }

  return summary;
}
