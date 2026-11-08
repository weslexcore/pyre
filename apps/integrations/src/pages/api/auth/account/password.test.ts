import { beforeEach, describe, expect, it, vi } from 'vitest';

const beginMutation = vi.fn();
const updateUser = vi.fn();
const updateUserById = vi.fn();
vi.mock('@/lib/auth/admin', () => ({ requireStaff: vi.fn() }));
vi.mock('@/lib/http/route', async () => {
  const { json } = await import('@/lib/http/json');
  return { beginMutation: (...args: unknown[]) => beginMutation(...args), json };
});
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => ({ auth: { updateUser } }),
}));

const { POST } = await import('./password');

const context = () => ({ cookies: {}, request: new Request('https://admin.test/') }) as never;

function ready(body: Record<string, unknown>) {
  return {
    gate: { user: { id: 'u1', email: 'ada@example.test' } },
    db: { auth: { admin: { updateUserById } } },
    email: 'ada@example.test',
    body,
  };
}

describe('POST /api/auth/account/password', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    updateUserById.mockResolvedValue({ error: null });
  });

  it('passes the gate response straight through (no session, no change)', async () => {
    beginMutation.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await POST(context())).status).toBe(401);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('sets the password and records that there is one', async () => {
    beginMutation.mockResolvedValue(ready({ password: 'long enough pw' }));
    updateUser.mockResolvedValue({ error: null });
    const res = await POST(context());
    expect(res.status).toBe(200);
    expect(updateUser).toHaveBeenCalledWith({ password: 'long enough pw' });
    expect(updateUserById).toHaveBeenCalledWith('u1', { app_metadata: { has_password: true } });
  });

  it('turns away a short password without calling Supabase', async () => {
    beginMutation.mockResolvedValue(ready({ password: 'short' }));
    expect((await POST(context())).status).toBe(400);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('does not record a password Supabase refused', async () => {
    beginMutation.mockResolvedValue(ready({ password: 'long enough pw' }));
    updateUser.mockResolvedValue({ error: { code: 'weak_password', message: 'weak' } });
    expect((await POST(context())).status).toBe(400);
    expect(updateUserById).not.toHaveBeenCalled();
  });
});
