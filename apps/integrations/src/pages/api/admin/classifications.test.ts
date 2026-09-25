// An admin's bulk reclassify: validated, capped, marks what it queues as
// pending, and skips notes deleted since the page loaded.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/admin', () => ({ assertSameOrigin: () => null }));
vi.mock('@/lib/db', () => ({ getDb: () => ({}) }));
vi.mock('@/lib/jev', () => ({ jevOptions: () => ({}) }));
const loadTexts = vi.fn();
vi.mock('@/lib/classify/subjects', () => ({
  SUBJECT_SOURCES: {
    shift_note: {
      authorize: async () => ({ user: { email: 'Wes@PyreSauna.com' }, access: { isAdmin: true } }),
      loadTexts: (...a: unknown[]) => loadTexts(...a),
      loadText: async () => 'text',
    },
  },
}));
const markQueued = vi.fn();
vi.mock('@/lib/classify/request', () => ({
  markQueued: (...a: unknown[]) => markQueued(...a),
  loadClassifications: vi.fn(),
  pendingView: () => ({ state: 'pending', signals: [], requestedAt: 'now', classifiedAt: null }),
}));
const dispatchClassifications = vi.fn();
vi.mock('@/lib/classify/dispatch', () => ({
  dispatchClassifications: (...a: unknown[]) => dispatchClassifications(...a),
  scheduleClassification: vi.fn(),
}));

const { POST } = await import('./classifications');

const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;

function post(body: unknown) {
  return POST({
    cookies: {},
    request: new Request('https://integrations.test/api/admin/classifications', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  } as never) as Promise<Response>;
}

describe('POST /api/admin/classifications (bulk)', () => {
  beforeEach(() => {
    loadTexts.mockReset();
    markQueued.mockReset().mockResolvedValue(true);
    dispatchClassifications.mockReset().mockResolvedValue({ via: 'qstash', queued: 1 });
  });

  it('queues the notes that still exist, forced and attributed to the admin', async () => {
    loadTexts.mockResolvedValue(new Map([[id(1), 'Towels low']]));
    const res = await post({ subject: 'shift_note', ids: [id(1), id(2), id(1)] });
    expect(res.status).toBe(202);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data).toMatchObject({ queued: 1, missing: 1 });
    expect(Object.keys(data.classifications as object)).toEqual([id(1)]);
    const items = [{ id: id(1), text: 'Towels low' }];
    expect(markQueued).toHaveBeenCalledWith({}, 'shift_note', items);
    expect(dispatchClassifications).toHaveBeenCalledWith('shift_note', items, {
      force: true,
      requestedBy: 'wes@pyresauna.com',
    });
  });

  it('rejects bad ids and runs over the cap', async () => {
    expect((await post({ subject: 'shift_note', ids: [] })).status).toBe(400);
    expect((await post({ subject: 'shift_note', ids: ['nope'] })).status).toBe(400);
    const tooMany = Array.from({ length: 501 }, (_, n) => id(n));
    expect((await post({ subject: 'shift_note', ids: tooMany })).status).toBe(400);
    expect(dispatchClassifications).not.toHaveBeenCalled();
  });
});
