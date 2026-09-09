// The schedule lint as a cron job.
//
// Reads the Momence events feed, runs every rule in ./rules, and emails the
// admins what it found. Nothing is written to Momence and nothing is stored:
// the send log's key — this week, the report digest, the recipient — is what
// makes the same list go out once, a changed list go out again, and anything
// still open get a Monday reminder.
//
// Cadence. The tick is hourly; this job runs when one of three things holds:
//   daily  — first tick at/after SYNC_HOUR_ET with no done-key for today, the
//            backstop that catches whatever the webhooks missed;
//   dirty  — a Momence session webhook set the dirty flag because QStash was
//            not available to schedule a debounced run (see ./trigger);
//   forced — `?job=schedule-lint&force=1`, which is how the QStash follow-up
//            to a webhook arrives, ten minutes after the last change.

import { utcToEastern, weekStartOf } from '@pyre/schedule-core';
import { getRedis } from '@pyre/webhook-core';
import { listStaff } from '@/lib/auth/access';
import type { CronJobContext } from '@/lib/cron/jobs';
import { sendTemplate } from '@/lib/email/send';
import { fetchMomenceEvents } from '@/lib/momence-events';
import { SYNC_HOUR_ET } from '@/lib/reports/schedule';
import { buildEmailProps } from './email';
import { countFindings, runLint } from './lint';
import { DIRTY_KEY, type LintTrigger } from './trigger';
import type { Severity } from './types';

const DONE_PREFIX = 'schedule-lint:done:';
/** A day plus slack for a run that had to resume. */
const DONE_TTL_SECONDS = 36 * 60 * 60;

/** Stop starting new sends with less than this left in the tick's budget. */
const TIME_FLOOR_MS = 5_000;

export interface ScheduleLintSummary {
  trigger: 'daily' | 'dirty' | 'forced' | 'dry-run';
  horizonStart?: string;
  horizonEnd?: string;
  findings: number;
  byRule?: Record<string, number>;
  bySeverity?: Record<Severity, number>;
  digest?: string;
  sent: number;
  /** Admins whose email was already claimed for this digest this week. */
  duplicates: number;
  failed: string[];
  skipped?: string;
  outOfTime?: boolean;
  /** Dry runs: who would be emailed. */
  wouldSend?: string[];
}

/** Everyone with the admin flag and an address — the notice audience. */
export async function listAdminEmails(): Promise<string[]> {
  const rows = await listStaff();
  if (!rows) return [];
  return rows.filter((r) => r.is_admin && r.email).map((r) => r.email as string);
}

export async function runScheduleLint(ctx: CronJobContext): Promise<ScheduleLintSummary> {
  const now = new Date();
  const eastern = utcToEastern(now.toISOString());
  const today = eastern.date;
  const doneKey = `${DONE_PREFIX}${today}`;

  const base: ScheduleLintSummary = {
    trigger: ctx.dryRun ? 'dry-run' : ctx.force ? 'forced' : 'daily',
    findings: 0,
    sent: 0,
    duplicates: 0,
    failed: [],
  };

  const redis = getRedis();
  if (!ctx.dryRun && !ctx.force) {
    // Without Redis there is no day gate, and an hourly lint would only be
    // wasteful, not wrong — but skip rather than guess.
    if (!redis) return { ...base, skipped: 'redis-unavailable' };
    const dirty = await redis.get<LintTrigger>(DIRTY_KEY);
    if (dirty) {
      base.trigger = 'dirty';
    } else {
      if (eastern.minutes < SYNC_HOUR_ET * 60) return { ...base, skipped: 'before-sync-hour' };
      if (await redis.get(doneKey)) return { ...base, skipped: 'already-done' };
    }
  }

  // Throws on an outage; the tick records the error and nothing is marked
  // done, so the next tick simply tries again.
  const events = await fetchMomenceEvents();
  const report = runLint(events, { now });
  const summary: ScheduleLintSummary = {
    ...base,
    horizonStart: report.horizonStart,
    horizonEnd: report.horizonEnd,
    findings: report.findings.length,
    ...countFindings(report.findings),
    digest: report.digest,
  };

  const finish = async () => {
    if (!redis) return;
    await redis.set(doneKey, { finishedAt: new Date().toISOString() }, { ex: DONE_TTL_SECONDS });
    await redis.del(DIRTY_KEY);
  };

  if (ctx.dryRun) {
    return { ...summary, wouldSend: report.findings.length > 0 ? await listAdminEmails() : [] };
  }

  if (report.findings.length === 0) {
    await finish();
    return summary;
  }

  const admins = await listAdminEmails();
  if (admins.length === 0) {
    await finish();
    return { ...summary, skipped: 'no-admins' };
  }

  const props = buildEmailProps(report);
  // This week + this exact list + this admin. Hourly re-runs are no-ops, a
  // changed list goes out at once, and an ignored one comes back on Monday.
  const weekStart = weekStartOf(today);
  for (const email of admins) {
    if (ctx.timeRemainingMs() < TIME_FLOOR_MS) {
      summary.outOfTime = true;
      break;
    }
    try {
      const result = await sendTemplate({
        to: email,
        template: 'schedule-lint',
        props,
        kind: 'transactional',
        sendKey: `schedule-lint:${weekStart}:${report.digest}:${email}`,
      });
      if (result.status === 'sent') summary.sent += 1;
      else if (result.reason === 'already-sent') summary.duplicates += 1;
    } catch (e) {
      console.error(`[schedule-lint] send to ${email} failed:`, e instanceof Error ? e.message : e);
      summary.failed.push(email);
    }
  }

  if (summary.outOfTime) {
    // The send-key claims already made let the next tick pick up exactly
    // where this one stopped; the dirty flag makes sure there is a next tick.
    if (redis) await redis.set(DIRTY_KEY, { reason: 'resume', at: now.toISOString() });
  } else {
    await finish();
  }

  return summary;
}
