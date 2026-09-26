// Queue a suggestion job to run in the background, the same way the
// classifier queues its reads (lib/classify/dispatch):
//
//   with QStash  — publish one message to /api/suggest/run. QStash calls the
//                  worker within seconds and retries it with backoff when the
//                  agents app can't be reached;
//   without it   — run the job in this instance's background (waitUntil),
//                  best-effort, as in local dev.
//
// Starting the agent is quick (it returns once the session exists); the
// agent's own work happens in pyre-agents afterwards.

import { waitUntil } from '@vercel/functions';
import { getDb } from '@/lib/db';
import { appOrigin } from '@/lib/origins';
import { workerQueue } from '@/lib/qstash';
import { runSuggestJob, type SuggestJob } from './worker';

export const SUGGEST_RETRIES = 3;

/**
 * How many suggestion jobs QStash starts at once. Each opens an agent
 * session, so this is kept low: a bulk reclassify that finds many actions
 * becomes a steady trickle of runs, not a burst of sessions.
 */
export const SUGGEST_PARALLELISM = 2;

export function suggestRunUrl(): string {
  return `${appOrigin()}/api/suggest/run`;
}

export type SuggestDispatchOutcome =
  | { via: 'qstash'; messageId: string }
  | { via: 'inline' }
  | { via: 'none'; reason: string };

/** Publish the job, or run it here when QStash is not configured. Never throws. */
export async function dispatchSuggestion(job: SuggestJob): Promise<SuggestDispatchOutcome> {
  try {
    const queue = await workerQueue();
    if (queue) {
      const { messageId } = await queue.client.publishJSON({
        url: suggestRunUrl(),
        body: job,
        retries: SUGGEST_RETRIES,
        flowControl: { key: 'suggest', parallelism: SUGGEST_PARALLELISM },
        headers: queue.headers,
      });
      return { via: 'qstash', messageId };
    }
  } catch (error) {
    console.error('[suggestions] QStash publish failed; running inline:', error);
  }

  const db = getDb();
  if (!db) return { via: 'none', reason: 'storage unavailable' };
  waitUntil(
    runSuggestJob(db, job, { finalAttempt: true }).catch((error) =>
      console.error('[suggestions] inline job failed:', error)
    )
  );
  return { via: 'inline' };
}
