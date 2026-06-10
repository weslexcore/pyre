import { getRedis } from '@pyre/webhook-core';

// Per-email idempotency markers, set AFTER a successful send so that Momence
// webhook retries never double-send, while a transient send failure still
// retries on the next delivery. Shares the same Upstash instance as traces.
const PREFIX = 'email:sent:';
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export async function alreadySent(key: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false; // no store -> cannot dedupe, allow the send
  const exists = await redis.exists(`${PREFIX}${key}`);
  return exists === 1;
}

export async function markSent(key: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.set(`${PREFIX}${key}`, Date.now(), { ex: TTL_SECONDS });
}
