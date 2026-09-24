// requestClassification is called on every shift note write, so what it
// skips matters as much as what it sends: nothing when the agent is not
// configured, nothing when the same text is already read or being read, and
// the pending row always filed before the session starts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeClassificationsDb } from './fake-db.test-helper';

const startEveSession = vi.fn();
vi.mock('@/lib/schedule/eve-session', () => ({
  startEveSession: (...args: unknown[]) => startEveSession(...args),
}));

const { contentHash, requestClassification } = await import('./request');

const NOTE_ID = '11111111-1111-4111-8111-111111111111';

describe('requestClassification', () => {
  beforeEach(() => {
    vi.stubEnv('AGENTS_BASE_URL', 'https://agents.test');
    vi.stubEnv('EVE_CHANNEL_SECRET', 'secret');
    startEveSession.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('does nothing when the agent is not configured', async () => {
    vi.stubEnv('AGENTS_BASE_URL', '');
    const { db, rows } = fakeClassificationsDb();
    expect(
      await requestClassification(db as never, 'shift_note', NOTE_ID, 'Towels low')
    ).toBeNull();
    expect(rows).toHaveLength(0);
    expect(startEveSession).not.toHaveBeenCalled();
  });

  it('files a pending request, then starts a classifier session carrying its id', async () => {
    const { db, rows, log } = fakeClassificationsDb();
    startEveSession.mockImplementation(async () => {
      // The row must already exist when the agent could first save.
      expect(log).toEqual(['upsert:pending']);
      return 'sess_1';
    });

    const view = await requestClassification(db as never, 'shift_note', NOTE_ID, 'Towels low');

    expect(view?.state).toBe('pending');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      subject_type: 'shift_note',
      subject_id: NOTE_ID,
      status: 'pending',
      content_hash: contentHash('Towels low'),
      agent_session_id: 'sess_1',
    });
    const [config, message] = startEveSession.mock.calls[0] as [
      { headers: Record<string, string> },
      string,
    ];
    expect(config.headers['x-pyre-agent']).toBe('classifier');
    expect(config.headers['x-pyre-classify-request']).toBe(rows[0]?.request_id);
    expect(message).toContain('<classify subject="shift_note">');
    expect(message).toContain('Towels low');
  });

  it('skips text that is already classified, unless forced', async () => {
    const { db } = fakeClassificationsDb([
      {
        id: 'row-1',
        subject_type: 'shift_note',
        subject_id: NOTE_ID,
        status: 'done',
        signals: [{ type: 'action', summary: 'Order towels' }],
        request_id: 'old',
        content_hash: contentHash('Towels low'),
        requested_at: new Date().toISOString(),
        classified_at: new Date().toISOString(),
      },
    ]);

    const same = await requestClassification(db as never, 'shift_note', NOTE_ID, '  Towels low ');
    expect(same?.signals).toEqual([{ type: 'action', summary: 'Order towels' }]);
    expect(startEveSession).not.toHaveBeenCalled();

    startEveSession.mockResolvedValue('sess_2');
    const forced = await requestClassification(db as never, 'shift_note', NOTE_ID, 'Towels low', {
      force: true,
    });
    expect(forced?.state).toBe('pending');
    expect(startEveSession).toHaveBeenCalledTimes(1);
  });

  it('re-reads changed text and rotates the request id', async () => {
    const { db, rows } = fakeClassificationsDb([
      {
        id: 'row-1',
        subject_type: 'shift_note',
        subject_id: NOTE_ID,
        status: 'done',
        signals: [],
        request_id: 'old',
        content_hash: contentHash('Smooth shift'),
        requested_at: new Date().toISOString(),
        classified_at: new Date().toISOString(),
      },
    ]);
    startEveSession.mockResolvedValue('sess_3');
    await requestClassification(db as never, 'shift_note', NOTE_ID, 'Heater is out');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.request_id).not.toBe('old');
    expect(rows[0]?.status).toBe('pending');
  });

  it('marks the request failed when the session cannot start', async () => {
    const { db, rows } = fakeClassificationsDb();
    startEveSession.mockRejectedValue(new Error('HTTP 502'));
    const view = await requestClassification(db as never, 'shift_note', NOTE_ID, 'Towels low');
    expect(view?.state).toBe('failed');
    expect(rows[0]).toMatchObject({ status: 'failed', error: 'HTTP 502' });
  });
});
