import { Redis, type RedisConfigNodejs } from '@upstash/redis';

let redis: Redis | null = null;

/** The Upstash REST credentials, or null when they aren't configured. */
function credentials(): Pick<RedisConfigNodejs, 'url' | 'token'> | null {
  const url = import.meta.env.KV_REST_API_URL;
  const token = import.meta.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    console.warn('[Redis] KV_REST_API_URL or KV_REST_API_TOKEN not configured');
    return null;
  }

  return { url, token };
}

export function getRedis(): Redis | null {
  if (redis) return redis;

  const creds = credentials();
  if (!creds) return null;

  redis = new Redis(creds);
  return redis;
}

/**
 * A separate client against the same instance, for callers that need
 * different transport behaviour from the shared one — most usefully a bounded
 * request time. The default client retries a failed call up to five times with
 * exponential backoff and never gives up on a hung connection, which is right
 * for a webhook writing an execution record and wrong for a page render that
 * has a visitor waiting on it.
 *
 * Returns null when Redis isn't configured; the caller is expected to treat
 * that the same as a cache miss.
 */
export function createRedis(config: Omit<RedisConfigNodejs, 'url' | 'token'>): Redis | null {
  const creds = credentials();
  if (!creds) return null;

  return new Redis({ ...creds, ...config });
}
