import { beforeEach, describe, expect, it, vi } from 'vitest';

const assertSameOrigin = vi.fn();
const getAccess = vi.fn();
const signInWithPassword = vi.fn();
const signOut = vi.fn();
const linkStaffUser = vi.fn();
vi.mock('@/lib/auth/admin', () => ({
  assertSameOrigin: (...args: unknown[]) => assertSameOrigin(...args),
}));
vi.mock('@/lib/auth/access', () => ({
  getAccess: (...args: unknown[]) => getAccess(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => ({ auth: { signInWithPassword, signOut } }),
  sessionCookieNames: () => ['pyre-sb', 'pyre-sb.0'],
}));
vi.mock('@/lib/auth/users', () => ({
  linkStaffUser: (...args: unknown[]) => linkStaffUser(...args),
}));
vi.mock('@/lib/db', () => ({ getDb: () => ({}) }));

const { POST } = await import('./password');

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
    request: new Request('https://admin.test/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never;
}

const ADA = { id: 'u1', email: 'ada@example.test' };

describe('POST /api/auth/password', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    assertSameOrigin.mockReturnValue(null);
    getAccess.mockResolvedValue({ isAdmin: false, pages: [] });
    signOut.mockResolvedValue({ error: null });
    linkStaffUser.mockResolvedValue(undefined);
  });

  it('signs a staff member in and answers with a safe destination', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: ADA }, error: null });
    const res = await POST(
      context({ email: 'Ada@Example.test', password: 'correct horse', returnUrl: '/admin/sops' })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirectTo: '/admin/sops' });
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'ada@example.test',
      password: 'correct horse',
    });
    expect(linkStaffUser).toHaveBeenCalledWith({}, 'u1', 'ada@example.test');
  });

  it('never asks Supabase about an address that is not on staff, and says the same thing', async () => {
    getAccess.mockResolvedValue(null);
    const res = await POST(context({ email: 'eve@example.test', password: 'whatever' }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/incorrect/);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('answers a wrong password with the same generic error', async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { status: 400, message: 'Invalid login credentials' },
    });
    const res = await POST(context({ email: 'ada@example.test', password: 'nope' }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/incorrect/);
  });

  it('signs straight back out when access is gone by the time the session exists', async () => {
    getAccess.mockResolvedValueOnce({ isAdmin: false, pages: [] }).mockResolvedValueOnce(null);
    signInWithPassword.mockResolvedValue({ data: { user: ADA }, error: null });
    const cookies = fakeCookies({ 'pyre-sb': 'session' });
    const res = await POST(context({ email: 'ada@example.test', password: 'pw' }, cookies));
    expect(res.status).toBe(400);
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(cookies.jar.has('pyre-sb')).toBe(false);
    expect(linkStaffUser).not.toHaveBeenCalled();
  });

  it('passes on rate limiting', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null }, error: { status: 429 } });
    expect((await POST(context({ email: 'ada@example.test', password: 'pw' }))).status).toBe(429);
  });
});
