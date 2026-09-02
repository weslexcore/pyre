// Short-lived cache for the Momence profile behind an access token. Every
// admin page and every /api/admin/* request validates the session, and until
// this cache each validation was a round trip to api.momence.com — the single
// largest cost on a checklist tap. Dashboard access itself is decided by the
// staff table (lib/auth/access), not by Momence, so trusting a profile for a
// few minutes changes nothing about who may use the dashboard; a revoked or
// rotated token simply misses here and is validated at Momence again.
//
// Two tiers: a module-scope map (free on a warm lambda) in front of Redis
// (shared across instances; skipped when unconfigured). Keys are a hash of the
// token — the token itself is never stored.

import { createHash } from 'node:crypto';
import { getRedis } from '@pyre/webhook-core';
import type { MomenceUserProfile } from './types';

export const PROFILE_TTL_MS = 10 * 60 * 1000;

const MAX_MEMORY_ENTRIES = 500;
const KEY_PREFIX = 'auth:profile:';

interface Entry {
  profile: MomenceUserProfile;
  /** Epoch ms after which the entry is stale. */
  expiresAt: number;
}

const memory = new Map<string, Entry>();

// getRedis() warns on every call when the KV env vars are absent, so resolve
// the client once per module rather than per request.
let redisClient: ReturnType<typeof getRedis> | undefined;
function redis(): ReturnType<typeof getRedis> {
  if (redisClient === undefined) redisClient = getRedis();
  return redisClient;
}

/** Cache key for a token: a SHA-256 hex digest, never the token itself. */
export function profileCacheKey(accessToken: string): string {
  return `${KEY_PREFIX}${createHash('sha256').update(accessToken).digest('hex')}`;
}

/**
 * How long a profile fetched at `now` may be cached: the fixed TTL, clamped
 * to the token's own expiry so a cached profile never outlives its token.
 * Zero or negative means don't cache.
 */
export function profileTtlMs(now: number, expiresAt: number): number {
  return Math.min(PROFILE_TTL_MS, expiresAt - now);
}

function readMemory(key: string, now: number): MomenceUserProfile | null {
  const hit = memory.get(key);
  if (!hit) return null;
  if (now >= hit.expiresAt) {
    memory.delete(key);
    return null;
  }
  // Re-insert so Map order tracks recency and eviction drops the coldest key.
  memory.delete(key);
  memory.set(key, hit);
  return hit.profile;
}

function writeMemory(key: string, profile: MomenceUserProfile, expiresAt: number): void {
  memory.delete(key);
  memory.set(key, { profile, expiresAt });
  while (memory.size > MAX_MEMORY_ENTRIES) {
    const oldest = memory.keys().next();
    if (oldest.done) break;
    memory.delete(oldest.value);
  }
}

export async function getCachedProfile(
  accessToken: string,
  now: number = Date.now()
): Promise<MomenceUserProfile | null> {
  const key = profileCacheKey(accessToken);
  const local = readMemory(key, now);
  if (local) return local;

  const client = redis();
  if (!client) return null;
  try {
    const remote = await client.get<MomenceUserProfile>(key);
    if (!remote || typeof remote !== 'object' || typeof remote.email !== 'string') return null;
    // Warm the local tier for the rest of this instance's life. The remote
    // TTL is unknown here; the local entry gets the full TTL again, which is
    // still bounded by the token expiry the remote entry was written under.
    writeMemory(key, remote, now + PROFILE_TTL_MS);
    return remote;
  } catch (error) {
    console.warn('[Auth] Profile cache read failed:', error);
    return null;
  }
}

export async function setCachedProfile(
  accessToken: string,
  profile: MomenceUserProfile,
  ttlMs: number,
  now: number = Date.now()
): Promise<void> {
  if (ttlMs <= 0) return;
  const key = profileCacheKey(accessToken);
  writeMemory(key, profile, now + ttlMs);

  const client = redis();
  if (!client) return;
  try {
    await client.set(key, profile, { ex: Math.max(1, Math.ceil(ttlMs / 1000)) });
  } catch (error) {
    console.warn('[Auth] Profile cache write failed:', error);
  }
}

/** Test hook: drop the in-memory tier. */
export function clearProfileCacheForTests(): void {
  memory.clear();
}
