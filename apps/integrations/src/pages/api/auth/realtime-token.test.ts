import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireStaff = vi.fn();
const supabasePublicConfig = vi.fn();
vi.mock('@/lib/auth/admin', () => ({
  requireStaff: (...args: unknown[]) => requireStaff(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  supabasePublicConfig: (...args: unknown[]) => supabasePublicConfig(...args),
}));

const { GET } = await import('./realtime-token');

describe('GET /api/auth/realtime-token', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    supabasePublicConfig.mockReturnValue({ url: 'https://p.supabase.co', key: 'sb_publishable_x' });
  });

  it('hands the signed-in person the project, their token, and their own topic', async () => {
    requireStaff.mockResolvedValue({
      user: { email: 'Ada@Example.test' },
      access: { isAdmin: false, pages: ['/admin/water'], source: 'db' },
      accessToken: 'jwt-123',
      expiresAt: 1_800_000_000_000,
    });
    const res = await GET({ cookies: {} } as never);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({
      url: 'https://p.supabase.co',
      key: 'sb_publishable_x',
      accessToken: 'jwt-123',
      expiresAt: 1_800_000_000_000,
      topic: 'notif:ada@example.test',
    });
  });

  it("passes the gate's refusal through and reports a missing token or config", async () => {
    requireStaff.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await GET({ cookies: {} } as never)).status).toBe(401);

    const gate = {
      user: { email: 'a@b.test' },
      access: { isAdmin: true, pages: [], source: 'db' },
      accessToken: null,
      expiresAt: null,
    };
    requireStaff.mockResolvedValue(gate);
    expect((await GET({ cookies: {} } as never)).status).toBe(503);

    requireStaff.mockResolvedValue({ ...gate, accessToken: 'jwt' });
    supabasePublicConfig.mockReturnValue(null);
    expect((await GET({ cookies: {} } as never)).status).toBe(503);
  });
});
