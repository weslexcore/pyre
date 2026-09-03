// The run log is a shared record: everyone reads it, but only for the SOPs
// they may view. That line is the whole security surface of the route, so it
// is what these tests pin — including the two ways it could quietly regress
// (scoping by participation again, or filtering after the row limit).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requirePage = vi.fn();
const getDb = vi.fn();
const getSopRole = vi.fn();

vi.mock('@/lib/auth/admin', () => ({
  requirePage: (c: unknown, p: unknown) => requirePage(c, p),
  requireAdmin: vi.fn(),
  assertSameOrigin: () => null,
}));
vi.mock('@/lib/db', () => ({ getDb: () => getDb() }));
vi.mock('@/lib/sops/role', () => ({ getSopRole: (e: unknown, a: unknown) => getSopRole(e, a) }));
vi.mock('@/lib/sops/people', () => ({ getPeopleNames: async () => ({}) }));

const { GET } = await import('./sop-runs');

const OPEN_SOP = '11111111-1111-1111-1111-111111111111';
const LOCKED_SOP = '22222222-2222-2222-2222-222222222222';

const sop = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  view_roles: ['staff', 'shift_lead', 'admin'],
  edit_roles: ['admin'],
  view_emails: [],
  edit_emails: [],
  archived: false,
  ...over,
});

const run = (id: string, sopId: string, startedBy: string) => ({
  id,
  sop_id: sopId,
  status: 'completed',
  started_by: startedBy,
  ended_by: startedBy,
  task_count: 1,
  sops: { title: 'A SOP', slug: 'a-sop', category: 'Ops' },
  sop_run_checks: [],
});

interface Filter {
  kind: 'eq' | 'in';
  column: string;
  value: unknown;
}

/**
 * A Supabase query-builder double that actually applies .eq()/.in() — the
 * point of these tests is which rows the database is asked for, so the fake
 * has to honor the narrowing rather than wave it through. Tables are recorded
 * when the chain is *awaited*, not when from() is called, since awaiting is
 * what sends the request; likewise or(), so a test can assert what was never
 * queried.
 */
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const tablesQueried: string[] = [];
  const orCalls: string[] = [];
  const db = {
    from(table: string) {
      const filters: Filter[] = [];
      const builder: Record<string, unknown> = {
        // biome-ignore lint/suspicious/noThenProperty: awaiting the chain is the Supabase builder's contract, so the fake has to be thenable too
        then: (resolve: (v: unknown) => unknown) => {
          tablesQueried.push(table);
          const rows = (tables[table] ?? []).filter((row) =>
            filters.every((f) =>
              f.kind === 'eq'
                ? row[f.column] === f.value
                : Array.isArray(f.value) && f.value.includes(row[f.column])
            )
          );
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      for (const method of ['select', 'order', 'limit']) builder[method] = () => builder;
      builder.eq = (column: string, value: unknown) => {
        filters.push({ kind: 'eq', column, value });
        return builder;
      };
      builder.in = (column: string, value: unknown) => {
        filters.push({ kind: 'in', column, value });
        return builder;
      };
      builder.or = (expr: string) => {
        orCalls.push(expr);
        return builder;
      };
      return builder;
    },
  };
  return { db, tablesQueried, orCalls };
}

const listRequest = () => ({
  cookies: {},
  url: new URL('https://pyre.test/api/admin/sop-runs?view=list'),
});

async function body(res: Response) {
  return (await res.json()) as { runs: { id: string }[]; scope: string; viewer: string };
}

describe('GET /api/admin/sop-runs?view=list', () => {
  beforeEach(() => {
    requirePage.mockReset();
    getDb.mockReset();
    getSopRole.mockReset();
  });

  function signIn(isAdmin: boolean, email = 'ada@pyre.test') {
    requirePage.mockResolvedValue({ user: { email }, access: { isAdmin } });
    getSopRole.mockResolvedValue(isAdmin ? 'admin' : 'staff');
  }

  it('shows a staff member everyone else’s runs, not just their own', async () => {
    signIn(false);
    const { db } = fakeDb({
      sops: [sop(OPEN_SOP)],
      sop_runs: [run('mine', OPEN_SOP, 'ada@pyre.test'), run('theirs', OPEN_SOP, 'bob@pyre.test')],
    });
    getDb.mockReturnValue(db);

    // biome-ignore lint/suspicious/noExplicitAny: the route's Astro context, narrowed to what GET reads
    const res = await GET(listRequest() as any);
    const data = await body(res);
    expect(data.runs.map((r) => r.id)).toEqual(['mine', 'theirs']);
    expect(data.scope).toBe('visible');
  });

  it('names the viewer so the log can mark the runs they started', async () => {
    signIn(false, 'Ada@Pyre.test');
    const { db } = fakeDb({
      sops: [sop(OPEN_SOP)],
      sop_runs: [run('mine', OPEN_SOP, 'ada@pyre.test')],
    });
    getDb.mockReturnValue(db);

    // biome-ignore lint/suspicious/noExplicitAny: the route's Astro context, narrowed to what GET reads
    const res = await GET(listRequest() as any);
    expect((await body(res)).viewer).toBe('ada@pyre.test');
  });

  it('hides runs of a SOP the viewer may not open', async () => {
    signIn(false);
    const { db } = fakeDb({
      sops: [sop(OPEN_SOP), sop(LOCKED_SOP, { view_roles: ['admin'], edit_roles: ['admin'] })],
      sop_runs: [
        run('visible', OPEN_SOP, 'bob@pyre.test'),
        run('secret', LOCKED_SOP, 'boss@pyre.test'),
      ],
    });
    getDb.mockReturnValue(db);

    // biome-ignore lint/suspicious/noExplicitAny: the route's Astro context, narrowed to what GET reads
    const res = await GET(listRequest() as any);
    expect((await body(res)).runs.map((r) => r.id)).toEqual(['visible']);
  });

  it('scopes by document, never by participation', async () => {
    signIn(false);
    const { db, tablesQueried, orCalls } = fakeDb({
      sops: [sop(OPEN_SOP)],
      sop_runs: [run('theirs', OPEN_SOP, 'bob@pyre.test')],
    });
    getDb.mockReturnValue(db);

    // biome-ignore lint/suspicious/noExplicitAny: the route's Astro context, narrowed to what GET reads
    await GET(listRequest() as any);
    // The old model asked sop_run_checks who the caller had checked items for,
    // then OR'd that into the run query. Neither may come back.
    expect(tablesQueried).not.toContain('sop_run_checks');
    expect(orCalls).toEqual([]);
  });

  it('answers empty when the viewer may open nothing, without querying runs', async () => {
    signIn(false);
    const { db, tablesQueried } = fakeDb({
      sops: [sop(LOCKED_SOP, { view_roles: ['admin'], edit_roles: ['admin'] })],
      sop_runs: [run('secret', LOCKED_SOP, 'boss@pyre.test')],
    });
    getDb.mockReturnValue(db);

    // biome-ignore lint/suspicious/noExplicitAny: the route's Astro context, narrowed to what GET reads
    const res = await GET(listRequest() as any);
    expect((await body(res)).runs).toEqual([]);
    // The run query is never sent — there is nothing it could legitimately
    // return, and an empty in.() list is not a filter worth trusting.
    expect(tablesQueried).not.toContain('sop_runs');
  });

  it('leaves admins unnarrowed — every run, archived documents included', async () => {
    signIn(true, 'boss@pyre.test');
    const { db, tablesQueried } = fakeDb({
      sops: [sop(OPEN_SOP), sop(LOCKED_SOP, { archived: true })],
      sop_runs: [
        run('visible', OPEN_SOP, 'bob@pyre.test'),
        run('secret', LOCKED_SOP, 'boss@pyre.test'),
      ],
    });
    getDb.mockReturnValue(db);

    // biome-ignore lint/suspicious/noExplicitAny: the route's Astro context, narrowed to what GET reads
    const res = await GET(listRequest() as any);
    const data = await body(res);
    expect(data.runs.map((r) => r.id)).toEqual(['visible', 'secret']);
    expect(data.scope).toBe('all');
    // No library read at all for an admin: nothing to narrow on.
    expect(tablesQueried).toEqual(['sop_runs']);
  });
});
