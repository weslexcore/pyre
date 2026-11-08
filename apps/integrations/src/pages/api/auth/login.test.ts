import { beforeEach, describe, expect, it, vi } from 'vitest';

const assertSameOrigin = vi.fn();
const signInWithOtp = vi.fn();
const createSupabaseServerClient = vi.fn();
vi.mock('@/lib/auth/admin', () => ({
  assertSameOrigin: (...args: unknown[]) => assertSameOrigin(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: (...args: unknown[]) => createSupabaseServerClient(...args),
}));

const { POST } = await import('./login');

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
  });

  it('rejects a missing or malformed email', async () => {
    expect((await POST(context({ email: 'not an email' }))).status).toBe(400);
    expect((await POST(context({}))).status).toBe(400);
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it('asks for a link back to this deployment, without creating users, and remembers the destination', async () => {
    const cookies = fakeCookies();
    const res = await POST(
      context({ email: ' Ada@Example.test ', returnUrl: '/admin/water' }, cookies)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: 'ada@example.test',
      options: {
        shouldCreateUser: false,
        emailRedirectTo: 'https://admin.test/api/auth/callback',
      },
    });
    expect(cookies.jar.get('pyre_return_url')).toBe('/admin/water');
  });

  it('answers an unknown address exactly like a known one', async () => {
    signInWithOtp.mockResolvedValue({
      data: {},
      error: { code: 'otp_disabled', message: 'Signups not allowed for otp', status: 422 },
    });
    const res = await POST(context({ email: 'stranger@example.test' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('passes a rate limit through and reports other failures', async () => {
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
