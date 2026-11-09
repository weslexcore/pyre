import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSupabaseServerClient = vi.fn();
const getClaims = vi.fn();
const getSession = vi.fn();
vi.mock('@/lib/supabase/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase/server')>();
  return {
    ...actual,
    createSupabaseServerClient: (...args: unknown[]) => createSupabaseServerClient(...args),
  };
});

const { sessionUserFromClaims, validateSession } = await import('./session');

function fakeCookies(initial: Record<string, string> = {}) {
  const jar = new Map(Object.entries(initial));
  const deleted: string[] = [];
  return {
    jar,
    deleted,
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    has: (name: string) => jar.has(name),
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
      deleted.push(name);
    },
  };
}

const claims = {
  sub: '11111111-1111-1111-1111-111111111111',
  email: 'Ada@Example.test',
  exp: 1_800_000_000,
  user_metadata: { display_name: 'Ada Lovelace' },
};

describe('validateSession', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    createSupabaseServerClient.mockReturnValue({ auth: { getClaims, getSession } });
    getSession.mockResolvedValue({ data: { session: { access_token: 'jwt-123' } } });
  });

  it('is unauthenticated without a session cookie, and never builds a client', async () => {
    const result = await validateSession(fakeCookies() as never);
    expect(result.session.isAuthenticated).toBe(false);
    expect(result.accessToken).toBeNull();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it('deletes the old Momence cookies on sight', async () => {
    const cookies = fakeCookies({ pyre_access_token: 'x', pyre_refresh_token: 'y' });
    await validateSession(cookies as never);
    expect(cookies.deleted).toEqual(
      expect.arrayContaining(['pyre_access_token', 'pyre_refresh_token', 'pyre_user_id'])
    );
    expect(cookies.jar.size).toBe(0);
  });

  it('builds the user from verified claims and returns the access token', async () => {
    getClaims.mockResolvedValue({ data: { claims }, error: null });
    const result = await validateSession(fakeCookies({ 'pyre-sb': 'session' }) as never);
    expect(result.session).toEqual({
      isAuthenticated: true,
      expiresAt: 1_800_000_000_000,
      user: {
        id: claims.sub,
        email: 'ada@example.test',
        displayName: 'Ada Lovelace',
        firstName: 'Ada',
        lastName: 'Lovelace',
      },
    });
    expect(result.accessToken).toBe('jwt-123');
  });

  it('accepts a chunked session cookie', async () => {
    getClaims.mockResolvedValue({ data: { claims }, error: null });
    const result = await validateSession(
      fakeCookies({ 'pyre-sb.0': 'a', 'pyre-sb.1': 'b' }) as never
    );
    expect(result.session.isAuthenticated).toBe(true);
  });

  it('is unauthenticated when the token is rejected or names no email', async () => {
    getClaims.mockResolvedValue({ data: null, error: { message: 'invalid JWT' } });
    expect(
      (await validateSession(fakeCookies({ 'pyre-sb': 's' }) as never)).session.user
    ).toBeNull();

    getClaims.mockResolvedValue({ data: { claims: { ...claims, email: undefined } }, error: null });
    expect(
      (await validateSession(fakeCookies({ 'pyre-sb': 's' }) as never)).session.user
    ).toBeNull();
  });

  it('is unauthenticated when sign-in is not configured', async () => {
    createSupabaseServerClient.mockReturnValue(null);
    const result = await validateSession(fakeCookies({ 'pyre-sb': 's' }) as never);
    expect(result.session.isAuthenticated).toBe(false);
  });
});

describe('sessionUserFromClaims', () => {
  it('falls back to the email local part when there is no display name', () => {
    const user = sessionUserFromClaims({ sub: 'u1', email: 'sam.jones@example.test', exp: 1 });
    expect(user).toEqual({
      id: 'u1',
      email: 'sam.jones@example.test',
      displayName: 'sam.jones',
      firstName: 'sam.jones',
      lastName: '',
    });
  });

  it('is null without a subject or an email', () => {
    expect(sessionUserFromClaims({ sub: '', email: 'a@b.c', exp: 1 })).toBeNull();
    expect(sessionUserFromClaims({ sub: 'u1', exp: 1 })).toBeNull();
  });
});
