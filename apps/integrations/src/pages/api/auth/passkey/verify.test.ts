import { beforeEach, describe, expect, it, vi } from 'vitest';

const assertSameOrigin = vi.fn();
const getAccess = vi.fn();
const verifyAuthentication = vi.fn();
const signOut = vi.fn();
const linkStaffUser = vi.fn();
vi.mock('@/lib/auth/admin', () => ({
  assertSameOrigin: (...args: unknown[]) => assertSameOrigin(...args),
}));
vi.mock('@/lib/auth/access', () => ({
  getAccess: (...args: unknown[]) => getAccess(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => ({ auth: { passkey: { verifyAuthentication }, signOut } }),
  sessionCookieNames: () => ['pyre-sb', 'pyre-sb.0'],
}));
vi.mock('@/lib/auth/users', () => ({
  linkStaffUser: (...args: unknown[]) => linkStaffUser(...args),
}));
vi.mock('@/lib/db', () => ({ getDb: () => ({}) }));

const { POST } = await import('./verify');

function fakeCookies(initial: Record<string, string> = {}) {
  const jar = new Map(Object.entries(initial));
  return {
    jar,
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    has: (name: string) => jar.has(name),
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  };
}

function context(body: unknown, cookies = fakeCookies()) {
  return {
    cookies,
    request: new Request('https://admin.test/api/auth/passkey/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never;
}

const CREDENTIAL = { id: 'cred', type: 'public-key', response: {} };

describe('POST /api/auth/passkey/verify', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    assertSameOrigin.mockReturnValue(null);
    getAccess.mockResolvedValue({ isAdmin: true, pages: [] });
    signOut.mockResolvedValue({ error: null });
    linkStaffUser.mockResolvedValue(undefined);
  });

  it('verifies the assertion and sends the person where they started', async () => {
    verifyAuthentication.mockResolvedValue({
      data: { user: { id: 'u1', email: 'ada@example.test' }, session: {} },
      error: null,
    });
    const cookies = fakeCookies({ pyre_return_url: '/admin/water' });
    const res = await POST(context({ challengeId: 'c1', credential: CREDENTIAL }, cookies));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirectTo: '/admin/water' });
    expect(verifyAuthentication).toHaveBeenCalledWith({
      challengeId: 'c1',
      credential: CREDENTIAL,
    });
    expect(cookies.jar.has('pyre_return_url')).toBe(false);
  });

  it('refuses and signs out someone with no dashboard access', async () => {
    getAccess.mockResolvedValue(null);
    verifyAuthentication.mockResolvedValue({
      data: { user: { id: 'u2', email: 'gone@example.test' }, session: {} },
      error: null,
    });
    const cookies = fakeCookies({ 'pyre-sb': 'session' });
    const res = await POST(context({ challengeId: 'c1', credential: CREDENTIAL }, cookies));
    expect(res.status).toBe(403);
    expect(signOut).toHaveBeenCalled();
    expect(cookies.jar.has('pyre-sb')).toBe(false);
  });

  it('explains an expired challenge', async () => {
    verifyAuthentication.mockResolvedValue({
      data: null,
      error: { code: 'webauthn_challenge_expired', message: 'expired' },
    });
    const res = await POST(context({ challengeId: 'c1', credential: CREDENTIAL }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/too long/);
  });

  it('rejects a body without a credential before asking Supabase', async () => {
    expect((await POST(context({ challengeId: 'c1' }))).status).toBe(400);
    expect(verifyAuthentication).not.toHaveBeenCalled();
  });
});
