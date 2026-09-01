// processCompletedReportRun — the host-report-run-completed webhook path.
// The cursor bookkeeping is the part worth pinning: a webhook must only
// finish runs a sync parked, must mirror the daily job's done-key semantics
// (forced cursors leave the scheduled pull free to run), and must leave the
// cursor alone when Momence's GET disagrees with its own webhook.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createReportRun = vi.fn();
const getReportRun = vi.fn();
const getDb = vi.fn();
const getRedis = vi.fn();
const normalizeReport = vi.fn();

vi.mock('@/lib/momence/reports', () => ({
  createReportRun: (args: unknown) => createReportRun(args),
  getReportRun: (id: number) => getReportRun(id),
  ReportUnavailableError: class extends Error {},
}));
vi.mock('@/lib/db', () => ({ getDb: () => getDb() }));
vi.mock('@pyre/webhook-core', () => ({ getRedis: () => getRedis() }));
vi.mock('@/lib/reports/normalize', () => ({
  normalizeReport: (type: unknown, items: unknown, date: unknown) =>
    normalizeReport(type, items, date),
}));

const { processCompletedReportRun } = await import('./sync');

function fakeRedis(seed: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(seed));
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
  };
}

/** Records upserts per table; both tables succeed. */
function fakeDb() {
  const upserts: Record<string, unknown[]> = {};
  return {
    upserts,
    from(table: string) {
      return {
        upsert: (rows: unknown) => {
          upserts[table] = (upserts[table] ?? []).concat(rows);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

const cursor = (over: Record<string, unknown> = {}) => ({
  date: '2026-08-31',
  rangeFrom: '2026-06-08',
  rangeTo: '2026-08-31',
  pending: [{ reportType: 'TOTAL_SALES', runId: 42 }],
  failed: [],
  ...over,
});

const completedRun = (items: unknown[] = [{ some: 'row' }]) => ({
  id: 42,
  status: 'completed',
  data: { reportType: 'total-sales', items },
});

beforeEach(() => {
  vi.clearAllMocks();
  normalizeReport.mockReturnValue({
    status: 'ok',
    metrics: [{ date: '2026-08-30', metric: 'revenue_total', value: 123 }],
  });
});

describe('processCompletedReportRun', () => {
  it('persists a pending run, clears the cursor, and marks the day done', async () => {
    const redis = fakeRedis({ 'report-sync:cursor': cursor() });
    const db = fakeDb();
    getRedis.mockReturnValue(redis);
    getDb.mockReturnValue(db);
    getReportRun.mockResolvedValue(completedRun());

    const result = await processCompletedReportRun(42);

    expect(result).toMatchObject({
      matched: true,
      prefix: 'report-sync',
      reportType: 'TOTAL_SALES',
      metricsUpserted: 1,
      pendingLeft: 0,
    });
    expect(db.upserts.momence_report_snapshots).toHaveLength(1);
    expect(db.upserts.business_metrics_daily).toHaveLength(1);
    expect(redis.store.has('report-sync:cursor')).toBe(false);
    expect(redis.store.has('report-sync:done:2026-08-31')).toBe(true);
  });

  it('does not set the done-key for a force-created cursor', async () => {
    const redis = fakeRedis({ 'report-sync:cursor': cursor({ force: true }) });
    getRedis.mockReturnValue(redis);
    getDb.mockReturnValue(fakeDb());
    getReportRun.mockResolvedValue(completedRun());

    const result = await processCompletedReportRun(42);

    expect(result.matched).toBe(true);
    expect(redis.store.has('report-sync:cursor')).toBe(false);
    expect(redis.store.has('report-sync:done:2026-08-31')).toBe(false);
  });

  it('ignores run ids no cursor is waiting on', async () => {
    const redis = fakeRedis({ 'report-sync:cursor': cursor() });
    getRedis.mockReturnValue(redis);
    getDb.mockReturnValue(fakeDb());

    const result = await processCompletedReportRun(999);

    expect(result).toEqual({ matched: false });
    expect(getReportRun).not.toHaveBeenCalled();
    expect(redis.store.has('report-sync:cursor')).toBe(true);
  });

  it('finds runs parked under the backfill prefix', async () => {
    const redis = fakeRedis({ 'report-sync:backfill:cursor': cursor({ force: true }) });
    getRedis.mockReturnValue(redis);
    getDb.mockReturnValue(fakeDb());
    getReportRun.mockResolvedValue(completedRun());

    const result = await processCompletedReportRun(42);

    expect(result).toMatchObject({ matched: true, prefix: 'report-sync:backfill' });
    expect(redis.store.has('report-sync:backfill:cursor')).toBe(false);
  });

  it('leaves the cursor for the poll fallback when the GET says still running', async () => {
    const redis = fakeRedis({ 'report-sync:cursor': cursor() });
    const db = fakeDb();
    getRedis.mockReturnValue(redis);
    getDb.mockReturnValue(db);
    getReportRun.mockResolvedValue({ id: 42, status: 'running', data: null });

    const result = await processCompletedReportRun(42);

    expect(result).toMatchObject({ matched: true, pendingLeft: 1 });
    expect(db.upserts).toEqual({});
    expect(redis.store.get('report-sync:cursor')).toEqual(cursor());
  });

  it('rewrites the cursor when other runs are still pending', async () => {
    const twoPending = cursor({
      pending: [
        { reportType: 'TOTAL_SALES', runId: 42 },
        { reportType: 'TOTAL_SALES', runId: 43 },
      ],
    });
    const redis = fakeRedis({ 'report-sync:cursor': twoPending });
    getRedis.mockReturnValue(redis);
    getDb.mockReturnValue(fakeDb());
    getReportRun.mockResolvedValue(completedRun());

    const result = await processCompletedReportRun(42);

    expect(result).toMatchObject({ matched: true, pendingLeft: 1 });
    const saved = redis.store.get('report-sync:cursor') as { pending: Array<{ runId: number }> };
    expect(saved.pending).toEqual([{ reportType: 'TOTAL_SALES', runId: 43 }]);
    expect(redis.store.has('report-sync:done:2026-08-31')).toBe(false);
  });
});
