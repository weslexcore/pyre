import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdmin = vi.fn();
const requirePage = vi.fn();
const assertSameOrigin = vi.fn();
const getDb = vi.fn();
vi.mock('@/lib/auth/admin', () => ({
  requireAdmin: (...args: unknown[]) => requireAdmin(...args),
  requirePage: (...args: unknown[]) => requirePage(...args),
  requireAnyPage: vi.fn(),
  assertSameOrigin: (...args: unknown[]) => assertSameOrigin(...args),
}));
vi.mock('@/lib/db', () => ({ getDb: () => getDb() }));

const { GET, POST, PATCH, DELETE } = await import('./cold-plunges');

type Row = Record<string, unknown>;

/**
 * Just enough of the Supabase query builder for this route: cold_plunges
 * reads and writes, and head-only counts of water_tests by tub.
 */
function fakeDb(plunges: Row[], entries: Record<string, number>) {
  return {
    from(table: string) {
      let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
      let payload: Row = {};
      const filters: Array<[string, unknown]> = [];
      const matching = () => plunges.filter((p) => filters.every(([col, v]) => p[col] === v));
      const result = (): { data?: unknown; error: null; count?: number } => {
        if (table === 'water_tests') {
          const tub = filters.find(([col]) => col === 'tub')?.[1] as string;
          return { count: entries[tub] ?? 0, error: null };
        }
        if (op === 'insert') {
          const row = { ...payload, archived: false, created_at: new Date().toISOString() };
          plunges.push(row);
          return { data: [row], error: null };
        }
        if (op === 'update') {
          const rows = matching();
          for (const row of rows) Object.assign(row, payload);
          return { data: rows, error: null };
        }
        if (op === 'delete') {
          for (const row of matching()) plunges.splice(plunges.indexOf(row), 1);
          return { error: null };
        }
        const rows = [...matching()].sort(
          (a, b) => (a.sort_order as number) - (b.sort_order as number)
        );
        return { data: rows, error: null };
      };
      const builder = {
        select: () => builder,
        insert: (row: Row) => {
          op = 'insert';
          payload = row;
          return builder;
        },
        update: (patch: Row) => {
          op = 'update';
          payload = patch;
          return builder;
        },
        delete: () => {
          op = 'delete';
          return builder;
        },
        eq: (col: string, value: unknown) => {
          filters.push([col, value]);
          return builder;
        },
        order: () => builder,
        single: async () => {
          const { data } = result();
          return { data: (data as Row[])[0], error: null };
        },
        maybeSingle: async () => {
          const { data } = result();
          return { data: (data as Row[])[0] ?? null, error: null };
        },
        // biome-ignore lint/suspicious/noThenProperty: mimics the awaitable query builder
        then: (resolve: (value: unknown) => void) => resolve(result()),
      };
      return builder;
    },
  };
}

const URL_BASE = 'https://example.test/api/admin/cold-plunges';

function ctx(method: string, body?: unknown, query = '') {
  return {
    cookies: {},
    url: new URL(`${URL_BASE}${query}`),
    request: new Request(`${URL_BASE}${query}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  } as never;
}

const admin = { user: { email: 'Admin@Example.test' }, access: { isAdmin: true } };
const staff = { user: { email: 'staff@example.test' }, access: { isAdmin: false } };

describe('cold plunges API', () => {
  let plunges: Row[];
  let entries: Record<string, number>;

  beforeEach(() => {
    vi.resetAllMocks();
    plunges = [
      { id: 'left', name: 'Left', gallons: 120, sort_order: 0, archived: false },
      { id: 'right', name: 'Right', gallons: 120, sort_order: 1, archived: false },
    ];
    entries = { left: 12, right: 0 };
    requireAdmin.mockResolvedValue(admin);
    requirePage.mockResolvedValue(admin);
    assertSameOrigin.mockReturnValue(null);
    getDb.mockImplementation(() => fakeDb(plunges, entries));
  });

  it('lists plunges for anyone with the water log, with entry counts only for admins', async () => {
    requirePage.mockResolvedValue(staff);
    const res = await GET(ctx('GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plunges.map((p: Row) => p.id)).toEqual(['left', 'right']);
    expect(body).toMatchObject({ entries: {}, canManage: false });
    expect(requirePage).toHaveBeenCalledWith(expect.anything(), '/admin/water');

    requirePage.mockResolvedValue(admin);
    expect(await (await GET(ctx('GET'))).json()).toMatchObject({
      entries: { left: 12, right: 0 },
      canManage: true,
    });
  });

  it('adds a plunge last, with a slug id that never collides', async () => {
    const res = await POST(ctx('POST', { name: 'Left', gallons: '60' }));
    expect(res.status).toBe(201);
    expect((await res.json()).plunge).toMatchObject({
      id: 'left-2',
      name: 'Left',
      gallons: 60,
      sort_order: 2,
      created_by: 'admin@example.test',
    });
  });

  it('rejects a plunge without usable gallons', async () => {
    expect((await POST(ctx('POST', { name: 'Garden', gallons: 0 }))).status).toBe(400);
    expect((await POST(ctx('POST', { name: 'Garden', gallons: 'lots' }))).status).toBe(400);
    expect(plunges).toHaveLength(2);
  });

  it('resizes, archives, and re-orders', async () => {
    const resized = await PATCH(ctx('PATCH', { id: 'right', gallons: 90 }));
    expect((await resized.json()).plunge).toMatchObject({ id: 'right', gallons: 90 });

    const archived = await PATCH(ctx('PATCH', { id: 'right', archived: true }));
    expect((await archived.json()).plunge.archived).toBe(true);

    const reordered = await PATCH(ctx('PATCH', { order: ['right', 'left'] }));
    expect((await reordered.json()).plunges.map((p: Row) => p.id)).toEqual(['right', 'left']);
  });

  it('404s an edit to a plunge that does not exist', async () => {
    expect((await PATCH(ctx('PATCH', { id: 'nope', name: 'X' }))).status).toBe(404);
  });

  it('refuses to delete a plunge with log entries, and deletes one without', async () => {
    const refused = await DELETE(ctx('DELETE', undefined, '?id=left'));
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toContain('Archive it instead');

    expect((await DELETE(ctx('DELETE', undefined, '?id=right'))).status).toBe(200);
    expect(plunges.map((p) => p.id)).toEqual(['left']);
  });

  it('keeps changes admin-only', async () => {
    requireAdmin.mockResolvedValue(new Response('Forbidden', { status: 403 }));
    expect((await POST(ctx('POST', { name: 'Garden', gallons: 60 }))).status).toBe(403);
    expect((await PATCH(ctx('PATCH', { id: 'left', gallons: 60 }))).status).toBe(403);
    expect((await DELETE(ctx('DELETE', undefined, '?id=right'))).status).toBe(403);
    expect(getDb).not.toHaveBeenCalled();
  });
});
