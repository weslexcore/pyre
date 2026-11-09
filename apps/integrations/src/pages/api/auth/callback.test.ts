import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyOtp = vi.fn();
const createSupabaseServerClient = vi.fn();
const linkStaffUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: (...args: unknown[]) => createSupabaseServerClient(...args),
}));
vi.mock('@/lib/auth/users', () => ({
  linkStaffUser: (...args: unknown[]) => linkStaffUser(...args),
}));
vi.mock('@/lib/db', () => ({ getDb: () => ({}) }));

const { GET } = await import('./callback');

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

function context(query: string, cookies = fakeCookies()) {
  return {
    cookies,
    url: new URL(`https://admin.test/api/auth/callback${query}`),
    redirect: (location: string, status = 302) =>
      new Response(null, { status, headers: { Location: location } }),
  } as never;
}

describe('GET /api/auth/callback', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    createSupabaseServerClient.mockReturnValue({ auth: { verifyOtp } });
    linkStaffUser.mockResolvedValue(undefined);
  });

  it('verifies the token hash, links the staff row, and lands on the remembered page', async () => {
    verifyOtp.mockResolvedValue({
      data: { user: { id: 'u1', email: 'ada@example.test' } },
      error: null,
    });
    const cookies = fakeCookies({ pyre_return_url: '/admin/water' });
    const res = await GET(context('?token_hash=abc&type=email', cookies));
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/admin/water');
    expect(verifyOtp).toHaveBeenCalledWith({ type: 'email', token_hash: 'abc' });
    expect(linkStaffUser).toHaveBeenCalledWith({}, 'u1', 'ada@example.test');
    expect(cookies.jar.has('pyre_return_url')).toBe(false);
  });

  it('defaults to /admin when the link is opened where no destination was remembered', async () => {
    verifyOtp.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.test' } }, error: null });
    const res = await GET(context('?token_hash=abc&type=email'));
    expect(res.headers.get('Location')).toBe('/admin');
  });

  it('sends a dead link back to the login page with a reason', async () => {
    const expired = await GET(context('?error=access_denied&error_code=otp_expired'));
    expect(expired.headers.get('Location')).toBe('/?returnUrl=%2Fadmin&error=link_expired');

    const incomplete = await GET(context('?type=email'));
    expect(incomplete.headers.get('Location')).toBe('/?returnUrl=%2Fadmin&error=invalid_callback');

    verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: 'Token has expired' } });
    const rejected = await GET(context('?token_hash=old&type=email'));
    expect(rejected.headers.get('Location')).toBe('/?returnUrl=%2Fadmin&error=link_expired');
    expect(linkStaffUser).not.toHaveBeenCalled();
  });
});
