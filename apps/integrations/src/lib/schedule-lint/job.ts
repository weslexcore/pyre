// The schedule lint as a cron job.
//
// Reads the Momence events feed, runs every rule in ./rules, and emails the
// admins what it found. Nothing is written to Momence: the send log's key —
// this week, the report digest, the recipient — is what makes the same list go
// out once and anything still open get a Monday reminder.
//
// Quiet. The feed keeps moving between runs: sessions drop out of it as they
// finish, so the list of findings can differ from the last one without
// anything having gone wrong. A changed list is therefore not enough to email
// about — a run only writes when it raises a finding key the week has not
// already reported, which is remembered in Redis under ./REPORTED_PREFIX and
// forgotten when the week turns over. So: something new, an email that day;
// the same trouble, one email a week; a list that only lost items, silence.
//
// Cadence. Once a day, off hours: the first hourly tick at/after LINT_HOUR_ET
// with no done-key for today. That is at most one email a day — Momence edits
// do not trigger runs, so a burst of schedule changes waits for the night.
// Two other ways in:
//   resume — a run that ran out of the tick's budget mid-send sets RESUME_KEY,
//            and the next tick finishes it (the send keys skip whoever has
//            already had the email);
//   forced — `?job=schedule-lint&force=1`, or "Email admins now" on the admin
//            page, for a person asking for the report.

import { utcToEastern, weekStartOf } from '@pyre/schedule-core';
import { getRedis } from '@pyre/webhook-core';
import { listStaff } from '@/lib/auth/access';
import type { CronJobContext } from '@/lib/cron/jobs';
import { getDb } from '@/lib/db';
import { sendTemplate } from '@/lib/email/send';
import { fetchMomenceEvents } from '@/lib/momence-events';
import { adminEmails } from '@/lib/notifications/recipients';
import { buildEmailProps } from './email';
import { countFindings, runLint } from './lint';
import { defaultRules, resolveRules } from './registry';
import { listResolutions, listRuleRows, touchResolutions } from './store';
import type { RuleInstance, Severity } from './types';

/**
 * Hour (ET) the daily run starts. Off hours, so the email is waiting in the
 * morning and the night's quiet schedule is what gets linted.
 */
export const LINT_HOUR_ET = 3;

/** Set when a run ran out of time mid-send; the next tick finishes it. */
export const RESUME_KEY = 'schedule-lint:resume';

const DONE_PREFIX = 'schedule-lint:done:';
/** A day plus slack for a run that had to resume. */
const DONE_TTL_SECONDS = 36 * 60 * 60;

/** The finding keys already emailed this week, by ET week start. */
const REPORTED_PREFIX = 'schedule-lint:reported:';
/** A week plus slack; a week that has rolled over is meant to be forgotten. */
const REPORTED_TTL_SECONDS = 9 * 24 * 60 * 60;

/** Stop starting new sends with less than this left in the tick's budget. */
const TIME_FLOOR_MS = 5_000;

export interface ScheduleLintSummary {
  trigger: 'daily' | 'resume' | 'forced' | 'dry-run';
  horizonStart?: string;
  horizonEnd?: string;
  findings: number;
  /** Findings per rule instance id. */
  byRule?: Record<string, number>;
  bySeverity?: Record<Severity, number>;
  digest?: string;
  /** Of `findings`, the ones this week has not emailed about yet. */
  newFindings?: number;
  /** Findings raised but left out because an admin marked them resolved. */
  resolved?: number;
  /** Resolutions dropped because nothing has raised their finding lately. */
  pruned?: number;
  sent: number;
  /** Admins whose email was already claimed for this digest this week. */
  duplicates: number;
  failed: string[];
  skipped?: string;
  outOfTime?: boolean;
  /** Dry runs: who would be emailed. */
  wouldSend?: string[];
}

/**
 * The rules as configured on /admin/schedule-lint; the built-in defaults
 * when Supabase is unavailable, so a storage hiccup never silences the lint.
 */
export async function loadRules(): Promise<RuleInstance[]> {
  const db = getDb();
  if (!db) return defaultRules();
  try {
    return resolveRules(await listRuleRows(db));
  } catch (e) {
    console.warn(
      '[schedule-lint] could not load rules, using defaults:',
      e instanceof Error ? e.message : e
    );
    return defaultRules();
  }
}

/**
 * The keys of findings the admins have already called fine. An unreachable
 * Supabase reads as "nothing resolved": the lint is noisier than it should
 * be for one run, which is the right way round to fail.
 */
export async function loadResolvedKeys(): Promise<Set<string>> {
  const db = getDb();
  if (!db) return new Set();
  try {
    return new Set((await listResolutions(db)).map((r) => r.key));
  } catch (e) {
    console.warn(
      '[schedule-lint] could not load resolutions, reporting everything:',
      e instanceof Error ? e.message : e
    );
    return new Set();
  }
}

/** Everyone with the admin flag and an address — the notice audience. */
export async function listAdminEmails(): Promise<string[]> {
  return adminEmails((await listStaff()) ?? []);
}

export interface ScheduleLintOptions {
  /**
   * Email the findings even when the week has already reported every one of
   * them — the admin page's "Email admins now", where a person is asking for
   * the report rather than waiting to be told. The send log still turns away
   * an admin who has had this exact list this week.
   */
  resend?: boolean;
}

export async function runScheduleLint(
  ctx: CronJobContext,
  { resend = false }: ScheduleLintOptions = {}
): Promise<ScheduleLintSummary> {
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
    // Without Redis there is no day gate, and an hourly lint would email
    // hourly — skip rather than guess.
    if (!redis) return { ...base, skipped: 'redis-unavailable' };
    if (await redis.get(RESUME_KEY)) {
      base.trigger = 'resume';
    } else {
      if (eastern.minutes < LINT_HOUR_ET * 60) return { ...base, skipped: 'before-lint-hour' };
      if (await redis.get(doneKey)) return { ...base, skipped: 'already-done' };
    }
  }

  // Throws on an outage; the tick records the error and nothing is marked
  // done, so the next tick simply tries again.
  const events = await fetchMomenceEvents();
  const [rules, resolvedKeys] = await Promise.all([loadRules(), loadResolvedKeys()]);
  const report = runLint(events, { now }, rules, resolvedKeys);
  const summary: ScheduleLintSummary = {
    ...base,
    horizonStart: report.horizonStart,
    horizonEnd: report.horizonEnd,
    findings: report.findings.length,
    ...countFindings(report.findings),
    digest: report.digest,
    resolved: report.resolved.length,
  };

  // A resolution lives as long as its finding keeps coming back; this is the
  // heartbeat that says it did, and the sweep for the ones that stopped.
  // Bookkeeping, never a reason to fail a run that has already found things.
  if (!ctx.dryRun) {
    const db = getDb();
    if (db) {
      try {
        const pruned = await touchResolutions(
          db,
          report.resolved.map((f) => f.key)
        );
        if (pruned > 0) summary.pruned = pruned;
      } catch (e) {
        console.warn(
          '[schedule-lint] could not update resolutions:',
          e instanceof Error ? e.message : e
        );
      }
    }
  }

  const finish = async () => {
    if (!redis) return;
    await redis.set(doneKey, { finishedAt: new Date().toISOString() }, { ex: DONE_TTL_SECONDS });
    await redis.del(RESUME_KEY);
  };

  // What of this list is news. Without Redis nothing is remembered, so every
  // finding reads as new — the same way round as the resolutions above: an
  // outage makes the lint louder, never quieter.
  const weekStart = weekStartOf(today);
  const reportedKey = `${REPORTED_PREFIX}${weekStart}`;
  const reported = new Set(redis ? ((await redis.get<string[]>(reportedKey)) ?? []) : []);
  const fresh = report.findings.filter((f) => !reported.has(f.key));
  summary.newFindings = fresh.length;

  if (ctx.dryRun) {
    return { ...summary, wouldSend: fresh.length > 0 ? await listAdminEmails() : [] };
  }

  if (report.findings.length === 0) {
    await finish();
    return summary;
  }

  // Nothing here the admins have not already been told about this week. The
  // list may well have changed — a session that ended has taken its finding
  // with it — but that is the clock talking, not the schedule.
  if (fresh.length === 0 && !resend) {
    await finish();
    return { ...summary, skipped: 'nothing-new' };
  }

  const admins = await listAdminEmails();
  if (admins.length === 0) {
    await finish();
    return { ...summary, skipped: 'no-admins' };
  }

  const props = buildEmailProps(report);
  // This week + this exact list + this admin. Repeat runs are no-ops, and a
  // list still open when the week turns over comes back as a Monday reminder.
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
    // where this one stopped; the resume flag makes sure there is a next tick.
    if (redis) await redis.set(RESUME_KEY, { at: now.toISOString() });
  } else {
    // Remember the list, so the rest of the week is quiet unless something
    // new turns up. Only after a clean pass: an admin the send threw for has
    // not been told, and the next run has to be free to try again.
    if (redis && summary.failed.length === 0) {
      await redis.set(reportedKey, [...reported, ...fresh.map((f) => f.key)], {
        ex: REPORTED_TTL_SECONDS,
      });
    }
    await finish();
  }

  return summary;
}
