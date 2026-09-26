import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdmin = vi.fn();
const assertSameOrigin = vi.fn();
const getDb = vi.fn();
vi.mock('@/lib/auth/admin', () => ({
  requireAdmin: (...args: unknown[]) => requireAdmin(...args),
  assertSameOrigin: (...args: unknown[]) => assertSameOrigin(...args),
}));
vi.mock('@/lib/db', () => ({ getDb: () => getDb() }));

const { PUT, DELETE } = await import('./settings');
const { getSetting, invalidateSettingsCache } = await import('@/lib/settings/store');
const key = 'navigation.hiddenTools';

function context(value: unknown = ['/admin/water']) {
  return {
    cookies: {},
    url: new URL(`https://example.test/api/admin/settings?key=${key}`),
    request: new Request('https://example.test/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    }),
  } as never;
}

describe('page visibility settings API', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invalidateSettingsCache();
    requireAdmin.mockResolvedValue({ user: { email: 'admin@example.test' } });
    assertSameOrigin.mockReturnValue(null);
    const rows = new Map<string, Record<string, unknown>>();
    getDb.mockReturnValue({
      from: () => ({
        select: async () => ({ data: [...rows.values()], error: null }),
        upsert: async (row: { key: string }) => {
          rows.set(row.key, { ...row, updated_at: '2026-09-25T12:00:00Z' });
          return { error: null };
        },
        delete: () => ({
          eq: async (_column: string, id: string) => {
            rows.delete(id);
            return { error: null };
          },
        }),
      }),
    });
  });

  it('persists changes, invalidates cached visibility, and resets to all visible', async () => {
    expect(await getSetting(key)).toEqual([]);
    const res = await PUT(context());
    expect(res.status).toBe(200);
    expect((await res.json()).settings).toContainEqual(
      expect.objectContaining({
        key,
        value: ['/admin/water'],
        source: 'saved',
        updatedBy: 'admin@example.test',
      })
    );
    expect(await getSetting(key)).toEqual(['/admin/water']);
    expect((await DELETE(context())).status).toBe(200);
    expect(await getSetting(key)).toEqual([]);
  });

  it('rejects non-admin changes and resets before touching storage', async () => {
    requireAdmin.mockResolvedValue(new Response('Forbidden', { status: 403 }));
    expect((await PUT(context())).status).toBe(403);
    expect((await DELETE(context())).status).toBe(403);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('rejects cross-origin changes', async () => {
    assertSameOrigin.mockReturnValue(new Response('Forbidden', { status: 403 }));
    expect((await PUT(context())).status).toBe(403);
    expect((await DELETE(context())).status).toBe(403);
    expect(getDb).not.toHaveBeenCalled();
  });

  it.each(['/admin/settings', '/admin/unknown'])('rejects hiding %s', async (href) => {
    expect((await PUT(context([href]))).status).toBe(400);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('reports save failures and retains the previous cached setting', async () => {
    await PUT(context());
    getDb.mockReturnValue({
      from: () => ({ upsert: async () => ({ error: { message: 'Save failed' } }) }),
    });
    const res = await PUT(context([]));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Save failed' });
    expect(await getSetting(key)).toEqual(['/admin/water']);
  });
});
