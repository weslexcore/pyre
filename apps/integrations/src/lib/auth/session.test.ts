import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stand-ins for the two session sources; each test decides what they return.
const { getClaims, getAuthTokens, getCachedProfile } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  getAuthTokens: vi.fn(),
  getCachedProfile: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => ({ auth: { getClaims } }),
}));
vi.mock('./cookies', () => ({ getAuthTokens, setAuthTokens: vi.fn() }));
vi.mock('./profile-cache', () => ({
  getCachedProfile,
  setCachedProfile: vi.fn(),
  profileTtlMs: () => 1000,
}));
vi.mock('./momence-oauth', () => ({
  fetchUserProfile: vi.fn(),
  isTokenExpired: () => false,
  refreshAccessToken: vi.fn(),
}));

import type { AstroCookies } from 'astro';
import { momenceLoginEnabled, validateSession } from './session';

const cookies = {} as AstroCookies;

const SUPABASE_CLAIMS = {
  data: {
    claims: {
      sub: '5d0c7a6e-0000-4000-8000-000000000001',
      email: 'Staff@PyreSauna.com',
      exp: 2_000_000_000,
      user_metadata: { first_name: 'Sam', last_name: 'Lee' },
    },
  },
  error: null,
};

const MOMENCE_TOKENS = { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 60_000 };
const MOMENCE_PROFILE = { id: 42, email: 'staff@pyresauna.com', firstName: 'Sam', lastName: 'Lee' };

beforeEach(() => {
  getClaims.mockReset();
  getAuthTokens.mockReset();
  getCachedProfile.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('validateSession', () => {
  it('prefers the Supabase session and normalizes its email', async () => {
    getClaims.mockResolvedValue(SUPABASE_CLAIMS);
    getAuthTokens.mockReturnValue(MOMENCE_TOKENS);

    const { session } = await validateSession(cookies);

    expect(session.source).toBe('supabase');
    expect(session.user).toEqual({
      id: SUPABASE_CLAIMS.data.claims.sub,
      email: 'staff@pyresauna.com',
      firstName: 'Sam',
      lastName: 'Lee',
    });
    expect(getAuthTokens).not.toHaveBeenCalled();
  });

  it('falls back to a Momence cutover session', async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error('no session') });
    getAuthTokens.mockReturnValue(MOMENCE_TOKENS);
    getCachedProfile.mockResolvedValue(MOMENCE_PROFILE);

    const { session } = await validateSession(cookies);

    expect(session.source).toBe('momence');
    expect(session.user?.id).toBe('42');
    expect(session.user?.email).toBe('staff@pyresauna.com');
  });

  it('ignores Momence cookies once the cutover is off', async () => {
    vi.stubEnv('AUTH_MOMENCE_LOGIN', 'off');
    getClaims.mockResolvedValue({ data: null, error: null });
    getAuthTokens.mockReturnValue(MOMENCE_TOKENS);
    getCachedProfile.mockResolvedValue(MOMENCE_PROFILE);

    const { session } = await validateSession(cookies);

    expect(session.isAuthenticated).toBe(false);
    expect(session.source).toBeNull();
  });

  it('treats claims without an email as signed out', async () => {
    getClaims.mockResolvedValue({
      data: { claims: { ...SUPABASE_CLAIMS.data.claims, email: '' } },
      error: null,
    });
    getAuthTokens.mockReturnValue(null);

    const { session } = await validateSession(cookies);
    expect(session.isAuthenticated).toBe(false);
  });
});

describe('momenceLoginEnabled', () => {
  it('is on unless explicitly off', () => {
    expect(momenceLoginEnabled()).toBe(true);
    vi.stubEnv('AUTH_MOMENCE_LOGIN', 'OFF');
    expect(momenceLoginEnabled()).toBe(false);
    vi.stubEnv('AUTH_MOMENCE_LOGIN', 'on');
    expect(momenceLoginEnabled()).toBe(true);
  });
});
