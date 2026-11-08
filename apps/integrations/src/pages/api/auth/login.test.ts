import { beforeEach, describe, expect, it, vi } from 'vitest';

const assertSameOrigin = vi.fn();
const signInWithOtp = vi.fn();
const createSupabaseServerClient = vi.fn();
const getAccess = vi.fn();
const listStaff = vi.fn();
const invalidateAccessCache = vi.fn();
const ensureAuthUser = vi.fn();
const linkStaffUser = vi.fn();
const getDb = vi.fn();
vi.mock('@/lib/auth/admin', () => ({
  assertSameOrigin: (...args: unknown[]) => assertSameOrigin(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: (...args: unknown[]) => createSupabaseServerClient(...args),
}));
vi.mock('@/lib/auth/access', () => ({
  getAccess: (...args: unknown[]) => getAccess(...args),
  listStaff: (...args: unknown[]) => listStaff(...args),
  invalidateAccessCache: (...args: unknown[]) => invalidateAccessCache(...args),
}));
vi.mock('@/lib/auth/users', () => ({
  ensureAuthUser: (...args: unknown[]) => ensureAuthUser(...args),
  linkStaffUser: (...args: unknown[]) => linkStaffUser(...args),
}));
vi.mock('@/lib/db', () => ({ getDb: () => getDb() }));

const { POST } = await import('./login');

const DB = { tag: 'db' };
const ACCESS = { isAdmin: false, pages: ['/admin/water'], source: 'db' };

function fakeCookies() {
  const jar = new Map<string, string>();
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
    url: new URL('https://admin.test/api/auth/login'),
    request: new Request('https://admin.test/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never;
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    assertSameOrigin.mockReturnValue(null);
    createSupabaseServerClient.mockReturnValue({ auth: { signInWithOtp } });
    signInWithOtp.mockResolvedValue({ data: {}, error: null });
    getDb.mockReturnValue(DB);
    getAccess.mockResolvedValue(ACCESS);
    listStaff.mockResolvedValue([
      { id: 's1', email: 'ada@example.test', display_name: 'Ada Lovelace', user_id: 'u1' },
      { id: 's2', email: 'new@example.test', display_name: 'New Person', user_id: null },
    ]);
    ensureAuthUser.mockResolvedValue({ ok: true, userId: 'u2', created: true });
    linkStaffUser.mockResolvedValue(undefined);
  });

  it('rejects a missing or malformed email', async () => {
    expect((await POST(context({ email: 'not an email' }))).status).toBe(400);
    expect((await POST(context({}))).status).toBe(400);
    expect(getAccess).not.toHaveBeenCalled();
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it('answers a stranger like a team member, without contacting Supabase', async () => {
    getAccess.mockResolvedValue(null);
    const cookies = fakeCookies();
    const res = await POST(context({ email: 'stranger@example.test' }, cookies));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(ensureAuthUser).not.toHaveBeenCalled();
    expect(signInWithOtp).not.toHaveBeenCalled();
    expect(cookies.jar.size).toBe(0);
  });

  it('sends a link to someone whose login exists, back to this deployment, and remembers the destination', async () => {
    const cookies = fakeCookies();
    const res = await POST(
      context({ email: ' Ada@Example.test ', returnUrl: '/admin/water' }, cookies)
    );
    expect(res.status).toBe(200);
    expect(getAccess).toHaveBeenCalledWith('ada@example.test');
    expect(ensureAuthUser).not.toHaveBeenCalled();
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: 'ada@example.test',
      options: {
        shouldCreateUser: false,
        emailRedirectTo: 'https://admin.test/api/auth/callback',
      },
    });
    expect(cookies.jar.get('pyre_return_url')).toBe('/admin/water');
  });

  it('creates and links the auth user on a first sign-in, then sends the link', async () => {
    const res = await POST(context({ email: 'new@example.test' }));
    expect(res.status).toBe(200);
    expect(ensureAuthUser).toHaveBeenCalledWith(DB, {
      email: 'new@example.test',
      displayName: 'New Person',
    });
    expect(linkStaffUser).toHaveBeenCalledWith(DB, 'u2', 'new@example.test');
    expect(invalidateAccessCache).toHaveBeenCalled();
    expect(signInWithOtp).toHaveBeenCalled();
  });

  it('creates an auth user for an env-allowlisted admin with no staff row', async () => {
    getAccess.mockResolvedValue({ isAdmin: true, pages: [], source: 'env' });
    const res = await POST(context({ email: 'boot@example.test' }));
    expect(res.status).toBe(200);
    expect(ensureAuthUser).toHaveBeenCalledWith(DB, {
      email: 'boot@example.test',
      displayName: null,
    });
    expect(linkStaffUser).not.toHaveBeenCalled();
    expect(signInWithOtp).toHaveBeenCalled();
  });

  it('reports a login that could not be set up, and sends nothing', async () => {
    ensureAuthUser.mockResolvedValue({ ok: false, error: 'admin api down' });
    const res = await POST(context({ email: 'new@example.test' }));
    expect(res.status).toBe(502);
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it('passes a rate limit through and reports other send failures', async () => {
    signInWithOtp.mockResolvedValue({ data: {}, error: { message: 'slow down', status: 429 } });
    expect((await POST(context({ email: 'ada@example.test' }))).status).toBe(429);

    signInWithOtp.mockResolvedValue({ data: {}, error: { message: 'smtp down', status: 500 } });
    expect((await POST(context({ email: 'ada@example.test' }))).status).toBe(502);
  });

  it('refuses cross-origin posts and reports when sign-in is unconfigured', async () => {
    assertSameOrigin.mockReturnValue(new Response(null, { status: 403 }));
    expect((await POST(context({ email: 'ada@example.test' }))).status).toBe(403);

    assertSameOrigin.mockReturnValue(null);
    createSupabaseServerClient.mockReturnValue(null);
    expect((await POST(context({ email: 'ada@example.test' }))).status).toBe(503);
  });
});
