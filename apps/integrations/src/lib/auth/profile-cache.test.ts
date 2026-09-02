import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@pyre/webhook-core', () => ({ getRedis: () => null }));

import {
  clearProfileCacheForTests,
  getCachedProfile,
  PROFILE_TTL_MS,
  profileCacheKey,
  profileTtlMs,
  setCachedProfile,
} from './profile-cache';

const PROFILE = { id: 7, email: 'staff@pyresauna.com', firstName: 'Sam', lastName: 'Lee' };

describe('profileCacheKey', () => {
  it('hashes the token rather than storing it', () => {
    const key = profileCacheKey('secret-token-value');
    expect(key.startsWith('auth:profile:')).toBe(true);
    expect(key.slice('auth:profile:'.length)).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain('secret-token-value');
  });

  it('differs per token', () => {
    expect(profileCacheKey('a')).not.toBe(profileCacheKey('b'));
  });
});

describe('profileTtlMs', () => {
  it('uses the fixed TTL when the token outlives it', () => {
    expect(profileTtlMs(1_000, 1_000 + PROFILE_TTL_MS * 5)).toBe(PROFILE_TTL_MS);
  });

  it('clamps to the token expiry', () => {
    expect(profileTtlMs(1_000, 61_000)).toBe(60_000);
  });

  it('is non-positive for an expired token', () => {
    expect(profileTtlMs(5_000, 5_000)).toBeLessThanOrEqual(0);
    expect(profileTtlMs(5_000, 1_000)).toBeLessThanOrEqual(0);
  });
});

describe('memory tier', () => {
  beforeEach(() => clearProfileCacheForTests());

  it('misses before a write', async () => {
    expect(await getCachedProfile('tok', 0)).toBeNull();
  });

  it('hits within the TTL and misses after it', async () => {
    await setCachedProfile('tok', PROFILE, 1_000, 0);
    expect(await getCachedProfile('tok', 500)).toEqual(PROFILE);
    expect(await getCachedProfile('tok', 1_000)).toBeNull();
  });

  it('does not cache when the TTL is non-positive', async () => {
    await setCachedProfile('tok', PROFILE, 0, 0);
    expect(await getCachedProfile('tok', 0)).toBeNull();
  });

  it('keeps tokens apart', async () => {
    await setCachedProfile('tok-a', PROFILE, 1_000, 0);
    expect(await getCachedProfile('tok-b', 0)).toBeNull();
  });
});
