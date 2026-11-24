import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
const fakeRedis = {
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  set: vi.fn(async (key: string, value: unknown) => {
    store.set(key, value);
    return 'OK';
  }),
  del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
};
const fetchContactPage = vi.fn();
const reconcileContacts = vi.fn(
  async (contacts: unknown[], _deps: unknown, tally: { scanned: number }) => {
    tally.scanned += contacts.length;
  }
);

vi.mock('@pyre/webhook-core', () => ({ getRedis: () => fakeRedis }));
vi.mock('@/lib/db', () => ({ getDb: () => ({}) }));
vi.mock('./resend', () => ({ getResend: () => ({}) }));
vi.mock('./suppression', () => ({ suppressEmail: vi.fn() }));
vi.mock('./resend-sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./resend-sync')>()),
  createPacer: () => async () => {},
  loadSuppressedEmails: async () => new Set<string>(),
  fetchContactPage: (...args: unknown[]) => fetchContactPage(...args),
  reconcileContacts: (...args: Parameters<typeof reconcileContacts>) => reconcileContacts(...args),
}));

const { runResendReconcile } = await import('./resend-reconcile-job');

const CURSOR_KEY = 'sweep:resend-reconcile:cursor';
/** 5am EST on 2026-11-24 — past the 4am hour. */
const AFTER_HOUR = new Date('2026-11-24T10:00:00Z');
const DONE_KEY = 'resend-reconcile:done:2026-11-24';
const ctx = (timeRemainingMs = () => 50_000) => ({ dryRun: false, timeRemainingMs });

beforeEach(() => {
  store.clear();
  fetchContactPage.mockReset();
  reconcileContacts.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(AFTER_HOUR);
});
afterEach(() => vi.useRealTimers());

describe('runResendReconcile', () => {
  it('waits for the reconcile hour', async () => {
    vi.setSystemTime(new Date('2026-11-24T07:00:00Z')); // 2am EST
    const summary = await runResendReconcile(ctx());
    expect(summary.skipped).toBe('before-hour');
    expect(fetchContactPage).not.toHaveBeenCalled();
  });

  it('pages through every contact, then marks the day done', async () => {
    fetchContactPage
      .mockResolvedValueOnce({ contacts: [{}, {}], next: 'c2' })
      .mockResolvedValueOnce({ contacts: [{}], next: null });
    const summary = await runResendReconcile(ctx());
    expect(summary).toMatchObject({ pages: 2, scanned: 3, finished: true });
    expect(fetchContactPage.mock.calls[1][2]).toEqual({ after: 'c2' });
    expect(store.has(DONE_KEY)).toBe(true);
    expect(store.has(CURSOR_KEY)).toBe(false);

    // Same day again: nothing to do.
    expect((await runResendReconcile(ctx())).skipped).toBe('already-done');
  });

  it('saves its place when time runs out and resumes from it', async () => {
    let remaining = 50_000;
    fetchContactPage.mockImplementationOnce(async () => {
      remaining = 1_000;
      return { contacts: [{}], next: 'c100' };
    });
    const first = await runResendReconcile(ctx(() => remaining));
    expect(first.finished).toBe(false);
    expect(store.get(CURSOR_KEY)).toBe('c100');
    expect(store.has(DONE_KEY)).toBe(false);

    fetchContactPage.mockResolvedValueOnce({ contacts: [{}], next: null });
    const second = await runResendReconcile(ctx());
    expect(second.trigger).toBe('resume');
    expect(fetchContactPage.mock.calls[1][2]).toEqual({ after: 'c100' });
    expect(second.finished).toBe(true);
    expect(store.has(CURSOR_KEY)).toBe(false);
  });

  it('is not finished when out of time before the first page', async () => {
    const summary = await runResendReconcile(ctx(() => 1_000));
    expect(summary.finished).toBe(false);
    expect(store.has(DONE_KEY)).toBe(false);
  });

  it('drops a saved cursor that Resend rejects', async () => {
    store.set(CURSOR_KEY, 'stale');
    fetchContactPage.mockRejectedValueOnce(new Error('bad cursor'));
    await expect(runResendReconcile(ctx())).rejects.toThrow('bad cursor');
    expect(store.has(CURSOR_KEY)).toBe(false);
  });
});
