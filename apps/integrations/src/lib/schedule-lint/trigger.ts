// How a Momence session webhook asks for a lint run.
//
// A schedule change arrives as a burst — a stack of Open Hours slots is
// twenty `session-created` events in a few seconds — and a lint of a
// half-built stack would email about a half-built stack. So the webhook
// never lints inline. It schedules one run for after the burst settles:
//
//   with QStash  — publish a delayed call to the cron tick, deduplicated on a
//                  ten-minute bucket so the whole burst collapses to one run;
//   without it   — set a dirty flag that the next hourly tick honours.
//
// Either way the run itself is ./job, and the send log keeps a run that found
// the same list from emailing again.

import { getRedis } from '@pyre/webhook-core';
import { appOrigin } from './labels';

export const DIRTY_KEY = 'schedule-lint:dirty';

/** How long after the last change the debounced run fires. */
export const DEBOUNCE_SECONDS = 10 * 60;

export interface LintTrigger {
  /** The webhook event, or 'resume' when a run ran out of time. */
  reason: string;
  sessionId?: number;
  at: string;
}

export type TriggerOutcome =
  | { via: 'qstash'; messageId: string }
  | { via: 'dirty-flag' }
  | { via: 'none'; reason: string };

/** The tick URL the delayed run calls; exported for the tests. */
export function lintRunUrl(): string {
  return `${appOrigin()}/api/cron/tick?job=schedule-lint&force=1`;
}

export async function requestLintRun(
  trigger: Omit<LintTrigger, 'at'>,
  now = new Date()
): Promise<TriggerOutcome> {
  const payload: LintTrigger = { ...trigger, at: now.toISOString() };
  const token = import.meta.env.QSTASH_TOKEN;
  const secret = import.meta.env.CRON_SECRET;

  if (token && secret) {
    // Lazy: the webhook route's cold start should not pay for the SDK unless
    // a session event actually arrives.
    const { Client } = await import('@upstash/qstash');
    const bucket = Math.floor(now.getTime() / (DEBOUNCE_SECONDS * 1000));
    const { messageId } = await new Client({ token }).publishJSON({
      url: lintRunUrl(),
      body: payload,
      delay: DEBOUNCE_SECONDS,
      // QStash drops a message whose id it has seen within its deduplication
      // window, so every event in the same ten-minute bucket becomes one run.
      deduplicationId: `schedule-lint:${bucket}`,
      // Forwarded to the tick as Authorization, which is what isCronAuthorized checks.
      headers: { Authorization: `Bearer ${secret}` },
    });
    return { via: 'qstash', messageId };
  }

  const redis = getRedis();
  if (redis) {
    await redis.set(DIRTY_KEY, payload);
    return { via: 'dirty-flag' };
  }

  return { via: 'none', reason: token ? 'cron-secret-missing' : 'qstash-and-redis-missing' };
}
