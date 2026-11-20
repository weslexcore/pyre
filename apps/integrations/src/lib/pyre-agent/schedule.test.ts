import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/schedule/duties', () => ({
  loadDutyCatalog: async () => ({ duties: [] }),
}));
vi.mock('@pyre/schedule-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pyre/schedule-core')>()),
  dutyLabel: (_catalog: unknown, key: string) => key,
}));
vi.mock('@/lib/schedule/draft-run', () => ({
  DRAFT_REQUEST_LAPSE_MS: 20 * 60 * 1000,
  isWeekStart: (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v),
  scheduleWeekHref: (w: string) => `/admin/schedule?view=week&date=${w}`,
}));

const { checkScheduleReview, loadScheduleDraft, replayScheduleReview } = await import('./schedule');

type Row = Record<string, unknown>;

/** Just enough of supabase-js's query builder for these reads. */
function fakeDb(tables: Record<string, Row[]>): SupabaseClient {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      let single = false;
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          rows = rows.filter((r) => r[col] === val);
          return builder;
        },
        neq: (col: string, val: unknown) => {
          rows = rows.filter((r) => r[col] !== val);
          return builder;
        },
        is: (col: string, val: unknown) => {
          rows = rows.filter((r) => (r[col] ?? null) === val);
          return builder;
        },
        gt: (col: string, val: string) => {
          rows = rows.filter((r) => String(r[col]) > val);
          return builder;
        },
        in: (col: string, vals: unknown[]) => {
          rows = rows.filter((r) => vals.includes(r[col]));
          return builder;
        },
        order: () => {
          rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
          return builder;
        },
        limit: (n: number) => {
          rows = rows.slice(0, n);
          return builder;
        },
        maybeSingle: () => {
          single = true;
          return builder;
        },
        // biome-ignore lint/suspicious/noThenProperty: mimics the awaitable builder
        then: (resolve: (v: { data: unknown; error: null }) => void) =>
          resolve({ data: single ? (rows[0] ?? null) : rows, error: null }),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const WEEK = '2026-11-30';
const P = '11111111-1111-4111-8111-111111111111';
const NEW_SHIFT = '22222222-2222-4222-8222-222222222222';
const LIVE_SHIFT = '33333333-3333-4333-8333-333333333333';
const A_MON = '44444444-4444-4444-8444-444444444444';
const A_TUE = '55555555-5555-4555-8555-555555555555';
const A_NEW = '66666666-6666-4666-8666-666666666666';

function tables(overrides: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return {
    schedule_proposals: [
      {
        id: P,
        week_start: WEEK,
        status: 'draft',
        rationale: 'Filled the week.',
        summary: { uncoveredShifts: 1, warnings: ['Wes is near his cap'] },
        created_at: '2026-11-23T14:05:00Z',
        decided_at: null,
      },
    ],
    schedule_draft_requests: [],
    shifts: [
      {
        id: NEW_SHIFT,
        proposal_id: P,
        is_draft: true,
        shift_date: '2026-12-04',
        label: 'Event',
        starts_at: '18:00:00',
        ends_at: '21:00:00',
        staff_needed: 1,
      },
      {
        id: LIVE_SHIFT,
        proposal_id: null,
        is_draft: false,
        shift_date: '2026-11-30',
        label: 'Evening',
        starts_at: '16:00:00',
        ends_at: '21:00:00',
        staff_needed: 2,
      },
    ],
    shift_assignments: [
      {
        id: A_MON,
        proposal_id: P,
        is_draft: true,
        shift_id: LIVE_SHIFT,
        staff_id: 's1',
        starts_at: '16:00:00',
        ends_at: '21:00:00',
        duties: ['host'],
      },
      {
        id: A_TUE,
        proposal_id: P,
        is_draft: true,
        shift_id: LIVE_SHIFT,
        staff_id: 's2',
        starts_at: '16:00:00',
        ends_at: '21:00:00',
        duties: [],
      },
      {
        id: A_NEW,
        proposal_id: P,
        is_draft: true,
        shift_id: NEW_SHIFT,
        staff_id: 's1',
        starts_at: '18:00:00',
        ends_at: '21:00:00',
        duties: [],
      },
    ],
    duty_assignments: [],
    staff: [
      { id: 's1', display_name: 'Sarah Lee' },
      { id: 's2', display_name: 'Wes M' },
    ],
    ...overrides,
  } as Record<string, Row[]>;
}

describe('loadScheduleDraft', () => {
  it('lists every draft item with a ref, its day, and who is on it', async () => {
    const view = await loadScheduleDraft(fakeDb(tables()), WEEK);
    expect(view.inProgress).toBeNull();
    expect(view.draft?.uncoveredShifts).toBe(1);
    expect(view.draft?.warnings).toEqual(['Wes is near his cap']);
    const refs = view.draft?.items.map((i) => i.ref) ?? [];
    expect(refs).toContain(`assignment:${A_MON}`);
    expect(refs).toContain(`shift:${NEW_SHIFT}`);
    const onNew = view.draft?.items.find((i) => i.ref === `assignment:${A_NEW}`);
    expect(onNew?.newShiftRef).toBe(`shift:${NEW_SHIFT}`);
    expect(onNew?.line).toContain('Sarah Lee');
    expect(view.draft?.items.find((i) => i.ref === `assignment:${A_MON}`)?.line).toContain(
      '4:00pm–9:00pm'
    );
  });

  it('says a draft is still coming while a recent request is open', async () => {
    const view = await loadScheduleDraft(
      fakeDb(
        tables({
          schedule_draft_requests: [
            {
              week_start: WEEK,
              kind: 'refine',
              requested_by: 'boss@pyresauna.com',
              completed_at: null,
              created_at: new Date().toISOString(),
            },
          ],
        })
      ),
      WEEK
    );
    expect(view.inProgress?.kind).toBe('refine');
  });

  it('reports how the last draft ended when none is open', async () => {
    const view = await loadScheduleDraft(
      fakeDb(
        tables({
          schedule_proposals: [
            {
              id: P,
              week_start: WEEK,
              status: 'approved',
              created_at: '2026-11-23T14:05:00Z',
              decided_at: '2026-11-24T10:00:00Z',
            },
          ],
        })
      ),
      WEEK
    );
    expect(view.draft).toBeNull();
    expect(view.last?.status).toBe('approved');
  });
});

describe('checkScheduleReview', () => {
  it('approves the whole draft in one call', async () => {
    const result = await checkScheduleReview(fakeDb(tables()), {
      weekStart: WEEK,
      acceptAll: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.steps).toEqual([
      expect.objectContaining({ body: { action: 'approve', proposalId: P } }),
    ]);
  });

  it('turns days and refs into the board review calls, behind an open-draft check', async () => {
    const result = await checkScheduleReview(fakeDb(tables()), {
      weekStart: WEEK,
      acceptDays: ['2026-11-30'],
      reject: [`assignment:${A_NEW}`, `shift:${NEW_SHIFT}`],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bodies = result.proposal.steps.map((s) => s.body);
    expect(bodies[0]).toEqual({ action: 'check-open', proposalId: P });
    expect(bodies).toContainEqual({ action: 'accept-item', kind: 'assignment', id: A_MON });
    expect(bodies).toContainEqual({ action: 'accept-item', kind: 'assignment', id: A_TUE });
    // The assignment goes before its shift.
    const rejects = bodies.filter((b) => b.action === 'reject-item');
    expect(rejects.map((b) => b.kind)).toEqual(['assignment', 'shift']);
    expect(result.proposal.summary).toContain('confirm 2 and drop 2 of 4');
  });

  it('refuses refs that are not in the open draft', async () => {
    const result = await checkScheduleReview(fakeDb(tables()), {
      weekStart: WEEK,
      accept: ['assignment:77777777-7777-4777-8777-777777777777'],
    });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('not an item') });
  });

  it('refuses confirming someone onto a new shift it drops', async () => {
    const result = await checkScheduleReview(fakeDb(tables()), {
      weekStart: WEEK,
      accept: [`assignment:${A_NEW}`],
      reject: [`shift:${NEW_SHIFT}`],
    });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('new shift') });
  });

  it('refuses while a revision is still being drafted', async () => {
    const result = await checkScheduleReview(
      fakeDb(
        tables({
          schedule_draft_requests: [
            {
              week_start: WEEK,
              kind: 'refine',
              requested_by: 'x',
              completed_at: null,
              created_at: new Date().toISOString(),
            },
          ],
        })
      ),
      { weekStart: WEEK, acceptAll: true }
    );
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('still being worked on'),
    });
  });

  it('asks for something to do', async () => {
    const result = await checkScheduleReview(fakeDb(tables()), { weekStart: WEEK });
    expect(result.ok).toBe(false);
  });
});

describe('replayScheduleReview', () => {
  const steps = [
    {
      method: 'POST' as const,
      path: '/api/admin/schedule-proposals',
      body: { action: 'check-open', proposalId: P },
    },
    {
      method: 'POST' as const,
      path: '/api/admin/schedule-proposals',
      body: { action: 'accept-item', kind: 'assignment', id: A_MON },
    },
    {
      method: 'POST' as const,
      path: '/api/admin/schedule-proposals',
      body: { action: 'accept-item', kind: 'assignment', id: A_TUE },
    },
  ];

  it('runs every confirmation, skipping the marker, and counts what failed', async () => {
    const run = vi.fn(async (step: { body: Record<string, unknown> }) =>
      step.body.id === A_TUE
        ? { status: 404, body: { error: 'Draft item not found' } }
        : { status: 200, body: {} }
    );
    const outcome = await replayScheduleReview(fakeDb(tables()), steps, run);
    expect(run).toHaveBeenCalledTimes(2);
    expect(outcome).toEqual({ ok: true, failed: 1, total: 2 });
  });

  it('refuses once the draft is no longer open', async () => {
    const run = vi.fn();
    const outcome = await replayScheduleReview(
      fakeDb(
        tables({
          schedule_proposals: [{ id: P, week_start: WEEK, status: 'superseded', created_at: 'x' }],
        })
      ),
      steps,
      run
    );
    expect(run).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining('no longer open') });
  });
});
