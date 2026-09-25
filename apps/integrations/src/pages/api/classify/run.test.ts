// The classify worker QStash calls: it acks what can never succeed (so QStash
// stops retrying), answers a failed classification with 503 (so QStash
// retries), and forces a re-run on a retry in case an earlier delivery died
// mid-run.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const isCronAuthorized = vi.fn();
vi.mock('@/lib/cron/auth', () => ({
  isCronAuthorized: (r: unknown) => isCronAuthorized(r),
  unauthorizedResponse: () => new Response('{}', { status: 401 }),
}));
const getDb = vi.fn(() => ({}));
vi.mock('@/lib/db', () => ({ getDb: () => getDb() }));
const runClassification = vi.fn();
vi.mock('@/lib/classify/request', () => ({
  runClassification: (...args: unknown[]) => runClassification(...args),
}));
const loadText = vi.fn();
vi.mock('@/lib/classify/subjects', () => ({
  SUBJECT_SOURCES: { shift_note: { loadText: (...a: unknown[]) => loadText(...a) } },
}));

const { POST } = await import('./run');

const NOTE_ID = '11111111-1111-4111-8111-111111111111';

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST({
    request: new Request('https://integrations.test/api/classify/run', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  } as never);
}

const done = { state: 'done', signals: [], requestedAt: '', classifiedAt: '' };

describe('POST /api/classify/run', () => {
  beforeEach(() => {
    isCronAuthorized.mockReturnValue(true);
    loadText.mockReset().mockResolvedValue('Towels low');
    runClassification.mockReset().mockResolvedValue(done);
  });

  it('rejects calls without the cron secret', async () => {
    isCronAuthorized.mockReturnValue(false);
    expect((await post({ subject: 'shift_note', id: NOTE_ID })).status).toBe(401);
  });

  it('classifies the record’s current text', async () => {
    const res = await post({ subject: 'shift_note', id: NOTE_ID });
    expect(res.status).toBe(200);
    expect(runClassification).toHaveBeenCalledWith({}, 'shift_note', NOTE_ID, 'Towels low', {
      force: false,
    });
  });

  it('asks QStash to retry when pyre-agents or Jev failed', async () => {
    runClassification.mockResolvedValue({ ...done, state: 'failed' });
    expect((await post({ subject: 'shift_note', id: NOTE_ID })).status).toBe(503);
  });

  it('forces the run on a retry or an admin re-run', async () => {
    await post({ subject: 'shift_note', id: NOTE_ID }, { 'Upstash-Retried': '1' });
    await post({ subject: 'shift_note', id: NOTE_ID, force: true });
    expect(runClassification.mock.calls.map((c) => (c[4] as { force: boolean }).force)).toEqual([
      true,
      true,
    ]);
  });

  it('acks jobs that can never succeed so QStash stops retrying', async () => {
    expect((await post({ subject: 'guest', id: NOTE_ID })).status).toBe(200);
    expect((await post({ subject: 'shift_note', id: 'nope' })).status).toBe(200);
    loadText.mockResolvedValue(null);
    expect((await post({ subject: 'shift_note', id: NOTE_ID })).status).toBe(200);
    expect(runClassification).not.toHaveBeenCalled();
  });
});
