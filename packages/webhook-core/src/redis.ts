import { Redis } from '@upstash/redis';

let redis: Redis | null = null;

export function getRedis(): Redis | null {
  if (redis) return redis;

  const url = import.meta.env.KV_REST_API_URL;
  const token = import.meta.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    console.warn('[Redis] KV_REST_API_URL or KV_REST_API_TOKEN not configured');
    return null;
  }

  redis = new Redis({ url, token });
  return redis;
}
