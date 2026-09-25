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
  /** Re-run even when the text is unchanged (an admin's "Run again"). */
  force?: boolean;
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
      const job: ClassifyJob = {
        subject,
        id: subjectId,
        ...(options.force ? { force: true } : {}),
      };
      // Preview deployments sit behind Vercel Deployment Protection, which
      // would 401 QStash at the edge; Vercel sets this secret when "Protection
      // Bypass for Automation" is on. The cron secret still authenticates.
      const bypass = import.meta.env.VERCEL_AUTOMATION_BYPASS_SECRET;
      const { messageId } = await new Client({ token }).publishJSON({
        url: classifyRunUrl(),
        body: job,
        retries: CLASSIFY_RETRIES,
        // Forwarded to the worker, which checks it with isCronAuthorized.
        headers: {
          Authorization: `Bearer ${secret}`,
          ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}),
        },
      });
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
