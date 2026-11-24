import type { SupabaseClient } from '@supabase/supabase-js';
import type { CreateBatchSuccessResponse, Resend } from 'resend';
import type { CronJobContext } from '@/lib/cron/jobs';
import { getDb } from '@/lib/db';
import { blockContentSchema } from '@/lib/email/journeys/schema';
import { getEmailGate } from '../dev-mode';
import { getResend } from '../resend';
import { createPacer, loadSuppressedEmails, type Pacer, pacedCall } from '../resend-sync';
import { buildUnsubscribeUrl } from '../unsubscribe-token';
import {
  BATCH_SIZE,
  batchIdempotencyKey,
  buildBatch,
  matchBatchResults,
  NEWSLETTER_TEMPLATE,
  newsletterSendKey,
} from './batch';
import { NewsletterContentError, renderNewsletter } from './render';

// Sends approved newsletters (status 'sending', due by send_after) one email
// per person, through Resend's batch endpoint, 100 at a time. Runs on every
// cron tick; a list too big for one tick carries on next tick from
// cursor_email.
//
// No one gets an issue twice: each copy is claimed in email_sends (send_key
// newsletter:{id}:{email}, unique) before it goes out, and a batch carries an
// idempotency key built from its claims. A batch Resend fails outright has its
// claims released and is retried on the next run; a single address Resend
// refuses is logged as failed and not retried.
//
// Like every marketing send: anyone on email_suppressions is skipped (read in
// full at the start of a run; without it nothing goes out), every copy has its
// own signed unsubscribe link and one-click headers, and the 'newsletter'
// template must be live in this environment (/admin/email-templates), or the
// run does nothing at all. Staging shares the production database, so a run
// that sent only to the whitelist would still move the cursor past everyone
// else.

/** Stop starting new batches with less than this left, so the tick can finish. */
const RESERVE_MS = 10_000;
/** Issues handled per run; more than one is due only when someone queues several. */
const MAX_ISSUES = 5;

interface NewsletterRow {
  id: string;
  campaign: string;
  list: string;
  content: unknown;
  cursor_email: string | null;
  sent_count: number;
  suppressed_count: number;
  failed_count: number;
  started_at: string | null;
}

export interface IssueSummary {
  id: string;
  campaign: string;
  sent: number;
  suppressed: number;
  failed: number;
  /** Already had this issue (a run before this one sent it). */
  alreadySent: number;
  /** Dry run: how many would be sent in this run. */
  wouldSend?: number;
  finished: boolean;
  error?: string;
}

export interface NewsletterSendSummary {
  dryRun: boolean;
  skipped?: string;
  issues: IssueSummary[];
}

export async function runNewsletterSends(ctx: CronJobContext): Promise<NewsletterSendSummary> {
  const summary: NewsletterSendSummary = { dryRun: ctx.dryRun, issues: [] };
  const db = getDb();
  const resend = getResend();
  if (!db) return { ...summary, skipped: 'no-db' };
  if (!resend) return { ...summary, skipped: 'resend-not-configured' };

  const { data, error } = await db
    .from('newsletters')
    .select(
      'id, campaign, list, content, cursor_email, sent_count, suppressed_count, failed_count, started_at'
    )
    .eq('status', 'sending')
    .or(`send_after.is.null,send_after.lte.${new Date().toISOString()}`)
    .order('created_at')
    .limit(MAX_ISSUES);
  if (error) throw new Error(`Could not read newsletters: ${error.message}`);
  const due = (data ?? []) as NewsletterRow[];
  if (due.length === 0) return summary;

  const gate = await getEmailGate();
  if (!gate.isLive(NEWSLETTER_TEMPLATE)) return { ...summary, skipped: 'template-not-live' };

  const suppressed = await loadSuppressedEmails(db);
  // || not ??: a blanked variable is an empty string.
  const from =
    import.meta.env.NEWSLETTER_FROM ||
    process.env.NEWSLETTER_FROM ||
    import.meta.env.RESEND_FROM ||
    'Pyre <hello@pyresauna.com>';
  const pace = createPacer();

  for (const row of due) {
    if (ctx.timeRemainingMs() < RESERVE_MS) break;
    summary.issues.push(await sendIssue(row, { db, resend, pace, suppressed, from, ctx }));
  }
  return summary;
}

interface SendDeps {
  db: SupabaseClient;
  resend: Resend;
  pace: Pacer;
  suppressed: Set<string>;
  from: string;
  ctx: CronJobContext;
}

async function sendIssue(row: NewsletterRow, deps: SendDeps): Promise<IssueSummary> {
  const { db, ctx } = deps;
  const issue: IssueSummary = {
    id: row.id,
    campaign: row.campaign,
    sent: 0,
    suppressed: 0,
    failed: 0,
    alreadySent: 0,
    ...(ctx.dryRun && { wouldSend: 0 }),
    finished: false,
  };

  const stop = async (message: string): Promise<IssueSummary> => {
    console.error(`[Newsletter] ${row.campaign} (${row.id}) stopped: ${message}`);
    if (!ctx.dryRun) {
      await db.from('newsletters').update({ last_error: message }).eq('id', row.id);
    }
    return { ...issue, error: message };
  };

  const parsed = blockContentSchema.safeParse(row.content);
  if (!parsed.success) return stop(`The saved content is not valid: ${parsed.error.message}`);

  let template: Awaited<ReturnType<typeof renderNewsletter>>;
  try {
    template = await renderNewsletter(parsed.data, row.campaign);
  } catch (error) {
    return stop(
      error instanceof NewsletterContentError
        ? error.problems.join(' ')
        : error instanceof Error
          ? error.message
          : String(error)
    );
  }

  if (!ctx.dryRun && !row.started_at) {
    await db
      .from('newsletters')
      .update({ started_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('started_at', null);
  }

  let cursor = row.cursor_email;
  const totals = {
    sent: row.sent_count,
    suppressed: row.suppressed_count,
    failed: row.failed_count,
  };

  while (ctx.timeRemainingMs() >= RESERVE_MS) {
    let query = db
      .from('newsletter_subscribers')
      .select('email, first_name')
      .contains('lists', [row.list])
      .order('email')
      .limit(BATCH_SIZE);
    if (cursor) query = query.gt('email', cursor);
    const { data: page, error } = await query;
    if (error) return stop(`Could not read the mailing list: ${error.message}`);
    if (!page || page.length === 0) {
      issue.finished = true;
      break;
    }

    const targets = page.filter((p) => !deps.suppressed.has(p.email));
    issue.suppressed += page.length - targets.length;

    if (ctx.dryRun) {
      issue.wouldSend = (issue.wouldSend ?? 0) + targets.length;
    } else if (targets.length > 0) {
      const outcome = await sendBatch(row, template, targets, deps);
      if ('error' in outcome) return stop(outcome.error);
      issue.sent += outcome.sent;
      issue.failed += outcome.failed;
      issue.alreadySent += outcome.alreadySent;
    }

    cursor = page[page.length - 1].email;
    if (!ctx.dryRun) {
      // Progress is saved after every batch, and only while the issue is still
      // sending: an admin who cancels mid-send stops it at the next batch.
      const { data: still, error: saveError } = await db
        .from('newsletters')
        .update({
          cursor_email: cursor,
          sent_count: totals.sent + issue.sent,
          suppressed_count: totals.suppressed + issue.suppressed,
          failed_count: totals.failed + issue.failed,
          last_error: null,
        })
        .eq('id', row.id)
        .eq('status', 'sending')
        .select('id');
      if (saveError) return stop(`Could not save progress: ${saveError.message}`);
      if (!still || still.length === 0) return { ...issue, error: 'cancelled' };
    }

    if (page.length < BATCH_SIZE) {
      issue.finished = true;
      break;
    }
  }

  if (issue.finished && !ctx.dryRun) {
    await db
      .from('newsletters')
      .update({ status: 'sent', finished_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'sending');
    console.info(
      `[Newsletter] ${row.campaign} finished: ${totals.sent + issue.sent} sent, ${totals.suppressed + issue.suppressed} suppressed, ${totals.failed + issue.failed} failed`
    );
  }
  return issue;
}

type BatchOutcome = { sent: number; failed: number; alreadySent: number } | { error: string };

async function sendBatch(
  row: NewsletterRow,
  template: Awaited<ReturnType<typeof renderNewsletter>>,
  targets: { email: string; first_name: string | null }[],
  { db, resend, pace, from }: SendDeps
): Promise<BatchOutcome> {
  const recipients = [];
  for (const t of targets) {
    const unsubscribeUrl = buildUnsubscribeUrl(t.email);
    // A marketing email without a working unsubscribe link is a compliance
    // bug, not a degraded mode.
    if (!unsubscribeUrl)
      return { error: 'No UNSUBSCRIBE_SECRET/CRON_SECRET to sign unsubscribe links' };
    recipients.push({ email: t.email, firstName: t.first_name, unsubscribeUrl });
  }
  const copies = buildBatch(template, recipients, { from, campaign: row.campaign });

  // Claim every copy first. ignoreDuplicates returns only the rows it
  // inserted, so anyone missing from the answer already has this issue.
  const rows = copies.map((c) => ({
    email: c.email,
    template: NEWSLETTER_TEMPLATE,
    kind: 'marketing',
    campaign: row.campaign,
    send_key: newsletterSendKey(row.id, c.email),
    subject: c.subject,
    status: 'sent',
  }));
  const { data: claimedRows, error: claimError } = await db
    .from('email_sends')
    .upsert(rows, { onConflict: 'send_key', ignoreDuplicates: true })
    .select('id, email');
  if (claimError) return { error: `Could not claim sends: ${claimError.message}` };

  const claimedIds = new Map((claimedRows ?? []).map((r) => [r.email as string, r.id as string]));
  const toSend = copies.filter((c) => claimedIds.has(c.email));
  const alreadySent = copies.length - toSend.length;
  if (toSend.length === 0) return { sent: 0, failed: 0, alreadySent };

  const sendKeys = toSend.map((c) => newsletterSendKey(row.id, c.email));
  const release = () =>
    db
      .from('email_sends')
      .delete()
      .in(
        'id',
        toSend.map((c) => claimedIds.get(c.email) as string)
      );

  const options = {
    batchValidation: 'permissive' as const,
    idempotencyKey: batchIdempotencyKey(row.id, sendKeys),
  };
  let result: Awaited<ReturnType<typeof pacedCall<CreateBatchSuccessResponse<typeof options>>>>;
  try {
    result = await pacedCall(pace, () =>
      resend.batch.send(
        toSend.map((c) => c.payload),
        options
      )
    );
  } catch (error) {
    await release();
    return {
      error: `Resend batch failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (result.error || !result.data) {
    await release();
    return { error: `Resend batch failed: ${result.error?.message ?? 'no data'}` };
  }

  const matched = matchBatchResults(
    toSend.length,
    result.data.data ?? [],
    result.data.errors ?? []
  );
  // One write records every outcome: the Resend id (which the Resend webhook
  // uses to stamp delivery and clicks), or why Resend refused the address.
  // The send_key stays on a refused copy, so it isn't retried.
  const outcomes = toSend.map((c, i) => ({
    ...rows.find((r) => r.email === c.email),
    id: claimedIds.get(c.email),
    resend_id: matched[i].id ?? null,
    status: matched[i].error ? 'failed' : 'sent',
    error: matched[i].error ?? null,
  }));
  const { error: recordError } = await db
    .from('email_sends')
    .upsert(outcomes, { onConflict: 'id' });
  if (recordError) {
    // The emails went out; only the bookkeeping is behind. Keep going.
    console.error(`[Newsletter] Could not record batch results: ${recordError.message}`);
  }

  const failed = matched.filter((m) => m.error).length;
  return { sent: toSend.length - failed, failed, alreadySent };
}
