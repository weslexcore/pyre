import { beforeEach, describe, expect, it, vi } from 'vitest';

const assertSameOrigin = vi.fn();
const verifyOtp = vi.fn();
const createSupabaseServerClient = vi.fn();
const linkStaffUser = vi.fn();
vi.mock('@/lib/auth/admin', () => ({
  assertSameOrigin: (...args: unknown[]) => assertSameOrigin(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: (...args: unknown[]) => createSupabaseServerClient(...args),
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
    request: new Request('https://admin.test/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never;
}

describe('POST /api/auth/verify', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    assertSameOrigin.mockReturnValue(null);
    createSupabaseServerClient.mockReturnValue({ auth: { verifyOtp } });
    linkStaffUser.mockResolvedValue(undefined);
  });

  it('verifies a 6-digit code (spaces tolerated) and answers with the destination', async () => {
    verifyOtp.mockResolvedValue({
      data: { user: { id: 'u1', email: 'ada@example.test' } },
      error: null,
    });
    const cookies = fakeCookies({ pyre_return_url: '/admin/sops' });
    const res = await POST(context({ email: 'Ada@Example.test', token: '123 456' }, cookies));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirectTo: '/admin/sops' });
    expect(verifyOtp).toHaveBeenCalledWith({
      email: 'ada@example.test',
      token: '123456',
      type: 'email',
    });
    expect(linkStaffUser).toHaveBeenCalledWith({}, 'u1', 'ada@example.test');
    expect(cookies.jar.has('pyre_return_url')).toBe(false);
  });

  it('rejects a code that is not six digits before asking Supabase', async () => {
    expect((await POST(context({ email: 'ada@example.test', token: '12345' }))).status).toBe(400);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('turns a refused code into a 400 the form can show', async () => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: 'Token has expired' } });
    const res = await POST(context({ email: 'ada@example.test', token: '000000' }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/did not work/);
    expect(linkStaffUser).not.toHaveBeenCalled();
  });
});
