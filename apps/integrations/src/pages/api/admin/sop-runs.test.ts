// The run log is a shared record: everyone reads it, but only for the SOPs
// they may view. That line is the whole security surface of the route, so it
// is what these tests pin — including the two ways it could quietly regress
// (scoping by participation again, or filtering after the row limit).
//
// The second block pins how items get resolved: a skip lands as a row
// flagged skipped (never overwriting a check), a required item (`- [!]`)
// refuses to be skipped at all, the run finishes itself once every item has
// a row, and there is no completing a run by hand.
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

const { GET, PATCH } = await import('./sop-runs');

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
    expect(tablesQueried).not.toContain('sops');
  });

  it('names the items a short-ended run skipped, from the version it pinned', async () => {
    signIn(false);
    const { db } = fakeDb({
      sops: [sop(OPEN_SOP)],
      sop_runs: [
        {
          ...run('short', OPEN_SOP, 'bob@pyre.test'),
          sop_version: 2,
          task_count: 3,
          sop_run_checks: [{ item_index: 1, item_text: 'Lock the gate' }],
        },
        { ...run('open', OPEN_SOP, 'ada@pyre.test'), status: 'in_progress', task_count: 3 },
      ],
      sop_versions: [
        // The run pinned v2; v3 renamed an item, and must not be what the log quotes.
        {
          sop_id: OPEN_SOP,
          version: 2,
          content_md: '- [ ] Rake coals\n- [ ] Lock the gate\n- [ ] Lights off\n',
        },
        {
          sop_id: OPEN_SOP,
          version: 3,
          content_md: '- [ ] Rake coals\n- [ ] Lock the gate\n- [ ] All lights off\n',
        },
      ],
    });
    getDb.mockReturnValue(db);

    // biome-ignore lint/suspicious/noExplicitAny: the route's Astro context, narrowed to what GET reads
    const res = await GET(listRequest() as any);
    const { runs } = (await res.json()) as {
      runs: { id: string; unchecked?: { item_index: number; item_text: string }[] }[];
    };
    expect(runs.find((r) => r.id === 'short')?.unchecked).toEqual([
      { item_index: 0, item_text: 'Rake coals' },
      { item_index: 2, item_text: 'Lights off' },
    ]);
    // Still running: nothing has been skipped yet.
    expect(runs.find((r) => r.id === 'open')?.unchecked).toBeUndefined();
  });
});

const RUN_ID = '33333333-3333-3333-3333-333333333333';

/**
 * A query-builder double for the PATCH tests, which write: upsert honours the
 * (run_id, item_index) uniqueness with ignoreDuplicates (a second resolution
 * of an item is dropped, as the real constraint drops it), update applies to
 * the rows the filters match, and maybeSingle hands back the first match.
 */
function mutableDb(tables: Record<string, Record<string, unknown>[]>) {
  const db = {
    from(table: string) {
      const filters: Filter[] = [];
      let orderBy: string | null = null;
      let op: 'read' | 'upsert' | 'update' = 'read';
      let payload: unknown;
      const matching = () => {
        const hit = (tables[table] ?? []).filter((row) =>
          filters.every((f) =>
            f.kind === 'eq'
              ? row[f.column] === f.value
              : Array.isArray(f.value) && f.value.includes(row[f.column])
          )
        );
        if (orderBy === null) return hit;
        const key = orderBy;
        return [...hit].sort((a, b) => Number(a[key]) - Number(b[key]));
      };
      const run = (): { data: Record<string, unknown>[]; error: null } => {
        if (op === 'upsert') {
          tables[table] ??= [];
          const rows = tables[table];
          const added: Record<string, unknown>[] = [];
          for (const row of payload as Record<string, unknown>[]) {
            const dup = rows.some(
              (r) => r.run_id === row.run_id && r.item_index === row.item_index
            );
            if (dup) continue;
            const stored = { id: `check-${rows.length + 1}`, checked_at: 'now', ...row };
            rows.push(stored);
            added.push(stored);
          }
          return { data: added, error: null };
        }
        if (op === 'update') {
          const hit = matching();
          for (const row of hit) Object.assign(row, payload as Record<string, unknown>);
          return { data: hit, error: null };
        }
        return { data: matching(), error: null };
      };
      const builder: Record<string, unknown> = {
        // biome-ignore lint/suspicious/noThenProperty: awaiting the chain is the Supabase builder's contract, so the fake has to be thenable too
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve),
        maybeSingle: () => {
          const { data } = run();
          return Promise.resolve({ data: data[0] ?? null, error: null });
        },
      };
      for (const method of ['select', 'limit']) builder[method] = () => builder;
      builder.order = (column: string) => {
        orderBy = column;
        return builder;
      };
      builder.eq = (column: string, value: unknown) => {
        filters.push({ kind: 'eq', column, value });
        return builder;
      };
      builder.upsert = (rows: unknown) => {
        op = 'upsert';
        payload = rows;
        return builder;
      };
      builder.update = (patch: unknown) => {
        op = 'update';
        payload = patch;
        return builder;
      };
      return builder;
    },
  };
  return { db, tables };
}

const patchRequest = (body: Record<string, unknown>) => ({
  cookies: {},
  request: new Request('https://pyre.test/api/admin/sop-runs', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }),
});

interface PatchBody {
  run: { status: string; ended_by: string | null } | null;
  checks?: { item_index: number; checked_by: string; skipped: boolean }[];
  error?: string;
}

describe('PATCH /api/admin/sop-runs', () => {
  beforeEach(() => {
    requirePage.mockReset();
    getDb.mockReset();
    getSopRole.mockReset();
    requirePage.mockResolvedValue({ user: { email: 'ada@pyre.test' }, access: { isAdmin: false } });
    getSopRole.mockResolvedValue('staff');
  });

  /**
   * An open three-item run with `checks` already resolved on it. `content`
   * overrides the document the run pinned — pass one with a `- [!]` item to
   * exercise the required-item guard.
   */
  function openRun(checks: Record<string, unknown>[], content = '- [ ] a\n- [ ] b\n- [ ] c\n') {
    return mutableDb({
      sop_runs: [
        {
          id: RUN_ID,
          sop_id: OPEN_SOP,
          sop_version: 1,
          task_count: 3,
          status: 'in_progress',
          started_by: 'bob@pyre.test',
          ended_by: null,
          ended_at: null,
          sops: sop(OPEN_SOP, { current_version: 1, content_md: content }),
        },
      ],
      sop_run_checks: checks.map((c) => ({ run_id: RUN_ID, skipped: false, ...c })),
    });
  }

  it('no longer completes a run by hand — every item has to be resolved', async () => {
    getDb.mockReturnValue(openRun([]).db);
    // biome-ignore lint/suspicious/noExplicitAny: the route's Astro context, narrowed to what PATCH reads
    const res = await PATCH(patchRequest({ runId: RUN_ID, action: 'complete' }) as any);
    expect(res.status).toBe(400);
    expect(((await res.json()) as PatchBody).error).toBe(
      'action must be check, uncheck, or discard'
    );
  });

  it('records a skip as a resolved row flagged skipped, by the session user', async () => {
    const { db, tables } = openRun([
      { item_index: 0, item_text: 'a', checked_by: 'bob@pyre.test' },
    ]);
    getDb.mockReturnValue(db);
    const res = await PATCH(
      patchRequest({
        runId: RUN_ID,
        action: 'check',
        items: [{ itemIndex: 1, itemText: 'b', skipped: true }],
        // biome-ignore lint/suspicious/noExplicitAny: the route's Astro context, narrowed to what PATCH reads
      }) as any
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as PatchBody;
    expect(body.checks?.map((c) => [c.item_index, c.skipped, c.checked_by])).toEqual([
      [0, false, 'bob@pyre.test'],
      [1, true, 'ada@pyre.test'],
    ]);
    // One item still open: the run stays in progress.
    expect(body.run?.status).toBe('in_progress');
    expect(tables.sop_run_checks.find((c) => c.item_index === 1)?.skipped).toBe(true);
  });

  it('keeps a teammate’s check when a skip of the same item races it', async () => {
    const { db, tables } = openRun([
      { item_index: 0, item_text: 'a', checked_by: 'bob@pyre.test' },
    ]);
    getDb.mockReturnValue(db);
    await PATCH(
      patchRequest({
        runId: RUN_ID,
        action: 'check',
        items: [{ itemIndex: 0, itemText: 'a', skipped: true }],
        // biome-ignore lint/suspicious/noExplicitAny: the route's Astro context, narrowed to what PATCH reads
      }) as any
    );
    expect(tables.sop_run_checks).toHaveLength(1);
    expect(tables.sop_run_checks[0]).toMatchObject({ checked_by: 'bob@pyre.test', skipped: false });
  });

  it('refuses to skip an item the document marks required, naming it', async () => {
    const { db, tables } = openRun([], '- [ ] a\n- [!] b\n- [ ] c\n');
    getDb.mockReturnValue(db);
    const res = await PATCH(
      patchRequest({
        runId: RUN_ID,
        action: 'check',
        items: [{ itemIndex: 1, itemText: 'b', skipped: true }],
        // biome-ignore lint/suspicious/noExplicitAny: the route's Astro context, narrowed to what PATCH reads
      }) as any
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as PatchBody).error).toBe(
      'These items must be checked off, not skipped: b'
    );
    // Nothing was written — not even the items that were fine to skip.
    expect(tables.sop_run_checks).toHaveLength(0);
  });

  it('takes a required item as completed, and skips of its neighbours', async () => {
    const { db, tables } = openRun([], '- [ ] a\n- [!] b\n- [ ] c\n');
    getDb.mockReturnValue(db);
    const res = await PATCH(
      patchRequest({
        runId: RUN_ID,
        action: 'check',
        items: [
          { itemIndex: 0, itemText: 'a', skipped: true },
          { itemIndex: 1, itemText: 'b' },
        ],
        // biome-ignore lint/suspicious/noExplicitAny: the route's Astro context, narrowed to what PATCH reads
      }) as any
    );
    expect(res.status).toBe(200);
    expect(tables.sop_run_checks.map((c) => [c.item_index, c.skipped])).toEqual([
      [0, true],
      [1, false],
    ]);
  });

  it('finishes the run the moment its last open item is skipped', async () => {
    const { db, tables } = openRun([
      { item_index: 0, item_text: 'a', checked_by: 'bob@pyre.test' },
      { item_index: 2, item_text: 'c', checked_by: 'bob@pyre.test' },
    ]);
    getDb.mockReturnValue(db);
    const res = await PATCH(
      // The bare single-item shorthand carries the flag too.
      // biome-ignore lint/suspicious/noExplicitAny: the route's Astro context, narrowed to what PATCH reads
      patchRequest({
        runId: RUN_ID,
        action: 'check',
        itemIndex: 1,
        itemText: 'b',
        skipped: true,
      }) as any
    );
    const body = (await res.json()) as PatchBody;
    expect(body.run?.status).toBe('completed');
    expect(body.run?.ended_by).toBe('ada@pyre.test');
    expect(body.checks?.map((c) => c.skipped)).toEqual([false, true, false]);
    expect(tables.sop_runs[0].status).toBe('completed');
  });
});
