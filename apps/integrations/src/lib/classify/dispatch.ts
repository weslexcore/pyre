// Queue a record's classification to run in the background, reacting to the
// write that changed its text rather than waiting for a sweep:
//
//   with QStash  — publish one message to /api/classify/run naming the record.
//                  QStash calls the worker within seconds and retries it with
//                  backoff when AI Gateway or Jev fails (the worker answers a
//                  failed run with a retryable status);
//   without it   — run the classification in this instance's background
//                  (waitUntil), best-effort, as in local dev.
//
// Either way the caller's response is never held: the publish itself runs in
// waitUntil after the note's response has gone out. A duplicate delivery
// costs nothing, because runClassification skips text it already classified.
//
// An admin's reclassify — one record, or many at once from the page's bulk
// panel — goes through dispatchClassifications: QStash batches, all jobs
// sharing one concurrency cap so a bulk run drains at a steady pace.

import type { SubjectType } from '@pyre/signals-core';
import { waitUntil } from '@vercel/functions';
import { getDb } from '@/lib/db';
import { jevOptions } from '@/lib/jev';
import { appOrigin } from '@/lib/schedule-lint/labels';
import { type ClassifyOptions, runClassification } from './request';

/** QStash retries a failed call this many times, with exponential backoff. */
export const CLASSIFY_RETRIES = 3;

/** The message body the worker reads. */
export interface ClassifyJob {
  subject: SubjectType;
  id: string;
  /** Re-run even when the text is unchanged (an admin's "Run Jev"). */
  force?: boolean;
  /** The admin who asked for the run, recorded with its answer. */
  requestedBy?: string;
  /** Start the suggestion agent once the answer is saved. */
  thenSuggest?: boolean;
}

export type DispatchOutcome =
  | { via: 'qstash'; messageId: string }
  | { via: 'inline' }
  | { via: 'none'; reason: string };

/** The worker URL QStash calls; exported for the tests. */
export function classifyRunUrl(): string {
  return `${appOrigin()}/api/classify/run`;
}

/**
 * Classify a record's current text in the background. Returns at once; call
 * it on every write that may have changed the text.
 */
export function scheduleClassification(
  subject: SubjectType,
  subjectId: string,
  text: string,
  options: ClassifyOptions = {}
): void {
  if (!jevOptions()) return;
  waitUntil(dispatchClassification(subject, subjectId, text, options));
}

/**
 * How many classifications QStash lets run at once, across every job — a
 * note's own write and a bulk reclassify alike — so a bulk run of hundreds
 * of notes queues up behind a steady trickle instead of hitting AI Gateway
 * all at once.
 */
export const CLASSIFY_PARALLELISM = 5;

/** Messages per QStash batch request. */
const PUBLISH_BATCH = 100;

/** Records run inline at once when QStash is not configured (local dev). */
const INLINE_PARALLELISM = 2;

/** The QStash message for one job: the worker, its auth, retries, and the shared concurrency cap. */
function jobMessage(
  subject: SubjectType,
  subjectId: string,
  options: ClassifyOptions,
  secret: string
) {
  const job: ClassifyJob = {
    subject,
    id: subjectId,
    ...(options.force ? { force: true } : {}),
    ...(options.requestedBy ? { requestedBy: options.requestedBy } : {}),
    ...(options.thenSuggest ? { thenSuggest: true } : {}),
  };
  // Preview deployments sit behind Vercel Deployment Protection, which
  // would 401 QStash at the edge; Vercel sets this secret when "Protection
  // Bypass for Automation" is on. The cron secret still authenticates.
  const bypass = import.meta.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return {
    url: classifyRunUrl(),
    body: job,
    retries: CLASSIFY_RETRIES,
    flowControl: { key: 'classify', parallelism: CLASSIFY_PARALLELISM },
    // Forwarded to the worker, which checks it with isCronAuthorized.
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}),
    },
  };
}

/** Publish the job to QStash, or run it here when QStash is not configured. Never throws. */
export async function dispatchClassification(
  subject: SubjectType,
  subjectId: string,
  text: string,
  options: ClassifyOptions = {}
): Promise<DispatchOutcome> {
  const token = import.meta.env.QSTASH_TOKEN;
  const secret = import.meta.env.CRON_SECRET;

  if (token && secret) {
    try {
      const { Client } = await import('@upstash/qstash');
      const { messageId } = await new Client({ token }).publishJSON(
        jobMessage(subject, subjectId, options, secret)
      );
      return { via: 'qstash', messageId };
    } catch (error) {
      // A QStash outage should not cost the note its classification.
      console.error('[classify] QStash publish failed; running inline:', error);
    }
  }

  const db = getDb();
  if (!db) return { via: 'none', reason: 'storage unavailable' };
  await runClassification(db, subject, subjectId, text, options);
  return { via: 'inline' };
}

export type BulkDispatchOutcome =
  | { via: 'qstash'; queued: number }
  | { via: 'inline'; queued: number }
  | { via: 'none'; reason: string };

/**
 * Queue many records at once (an admin's bulk reclassify): QStash batches,
 * run at CLASSIFY_PARALLELISM at a time; without QStash, a few at a time in
 * this instance's background. Awaits the publish (not the runs), so the
 * caller can say what was queued. Never throws.
 */
export async function dispatchClassifications(
  subject: SubjectType,
  items: ReadonlyArray<{ id: string; text: string }>,
  options: ClassifyOptions = {}
): Promise<BulkDispatchOutcome> {
  if (items.length === 0) return { via: 'none', reason: 'nothing to classify' };
  const token = import.meta.env.QSTASH_TOKEN;
  const secret = import.meta.env.CRON_SECRET;

  if (token && secret) {
    try {
      const { Client } = await import('@upstash/qstash');
      const client = new Client({ token });
      for (let i = 0; i < items.length; i += PUBLISH_BATCH) {
        await client.batchJSON(
          items
            .slice(i, i + PUBLISH_BATCH)
            .map((item) => jobMessage(subject, item.id, options, secret))
        );
      }
      return { via: 'qstash', queued: items.length };
    } catch (error) {
      // A batch that failed partway may have queued some; running those
      // again inline is harmless (the last answer wins).
      console.error('[classify] QStash batch publish failed; running inline:', error);
    }
  }

  const db = getDb();
  if (!db) return { via: 'none', reason: 'storage unavailable' };
  const queue = [...items];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      await runClassification(db, subject, item.id, item.text, options);
    }
  };
  waitUntil(Promise.all(Array.from({ length: INLINE_PARALLELISM }, worker)));
  return { via: 'inline', queued: items.length };
}
