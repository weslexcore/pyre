// The background run behind every shift note write: it skips unchanged text,
// files its request before asking pyre-agents, and never lets a stale run
// overwrite a newer one. Scheduling it is ./dispatch (dispatch.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeClassificationsDb } from './fake-db.test-helper';

const { contentHash, runClassification } = await import('./request');

const NOTE_ID = '11111111-1111-4111-8111-111111111111';

const PROBABILITIES = { action: 0.82, question: 0.1, update: 0.05, feedback: 0.2, safety: 0.01 };

function agents(response: () => Response | Promise<Response>) {
  return vi.fn(async (_url: string, _init?: RequestInit) => response());
}

describe('runClassification', () => {
  beforeEach(() => {
    vi.stubEnv('AGENTS_BASE_URL', 'https://agents.test/');
    vi.stubEnv('EVE_CHANNEL_SECRET', 'secret');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('files a pending request, asks pyre-agents, and stores what clears the thresholds', async () => {
    const { db, rows, log } = fakeClassificationsDb();
    const fetch = agents(() => {
      // The row must exist before the answer can be written against it.
      expect(log).toEqual(['upsert:pending']);
      return Response.json({ model: 'typesafe-ai/jev', probabilities: PROBABILITIES });
    });

    const view = await runClassification(db as never, 'shift_note', NOTE_ID, 'Towels low', {
      fetch: fetch as never,
    });

    expect(view?.state).toBe('done');
    expect(view?.signals).toEqual([{ type: 'action', probability: 0.82 }]);
    expect(rows[0]).toMatchObject({
      subject_type: 'shift_note',
      subject_id: NOTE_ID,
      status: 'done',
      model: 'typesafe-ai/jev',
      attempts: 1,
      content_hash: contentHash('Towels low'),
    });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://agents.test/pyre/classify');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    expect(JSON.parse(init.body as string)).toEqual({ subject: 'shift_note', text: 'Towels low' });
  });

  it('skips text that is already classified, unless forced', async () => {
    const { db } = fakeClassificationsDb([
      {
        id: 'row-1',
        subject_type: 'shift_note',
        subject_id: NOTE_ID,
        status: 'done',
        signals: [{ type: 'action', probability: 0.9 }],
        request_id: 'old',
        content_hash: contentHash('Towels low'),
        attempts: 1,
        requested_at: new Date().toISOString(),
        classified_at: new Date().toISOString(),
      },
    ]);
    const fetch = agents(() => Response.json({ probabilities: PROBABILITIES }));

    const same = await runClassification(db as never, 'shift_note', NOTE_ID, '  Towels low ', {
      fetch: fetch as never,
    });
    expect(same?.signals).toEqual([{ type: 'action', probability: 0.9 }]);
    expect(fetch).not.toHaveBeenCalled();

    await runClassification(db as never, 'shift_note', NOTE_ID, 'Towels low', {
      force: true,
      fetch: fetch as never,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('counts attempts per text and resets them when the text changes', async () => {
    const { db, rows } = fakeClassificationsDb([
      {
        id: 'row-1',
        subject_type: 'shift_note',
        subject_id: NOTE_ID,
        status: 'failed',
        signals: [],
        request_id: 'old',
        content_hash: contentHash('Towels low'),
        attempts: 2,
        requested_at: new Date().toISOString(),
        classified_at: null,
      },
    ]);
    const failing = agents(() => Response.json({ error: 'Jev down' }, { status: 502 }));

    const view = await runClassification(db as never, 'shift_note', NOTE_ID, 'Towels low', {
      fetch: failing as never,
    });
    expect(view?.state).toBe('failed');
    expect(rows[0]).toMatchObject({ attempts: 3, status: 'failed' });
    expect(rows[0]?.error).toMatch(/502.*Jev down/);

    await runClassification(db as never, 'shift_note', NOTE_ID, 'Heater is out', {
      fetch: failing as never,
    });
    expect(rows[0]?.attempts).toBe(1);
  });

  it('writes nothing when a newer run replaced this one mid-flight', async () => {
    const { db, rows } = fakeClassificationsDb();
    const fetch = agents(() => {
      // An edit lands while Jev is answering and rotates the request id.
      (rows[0] as Record<string, unknown>).request_id = 'newer';
      return Response.json({ probabilities: PROBABILITIES });
    });
    const view = await runClassification(db as never, 'shift_note', NOTE_ID, 'Towels low', {
      fetch: fetch as never,
    });
    expect(view).toBeNull();
    expect(rows[0]?.status).toBe('pending');
  });

  it('marks an answer that fails validation as failed', async () => {
    const { db, rows } = fakeClassificationsDb();
    const fetch = agents(() => Response.json({ probabilities: { action: 7 } }));
    await runClassification(db as never, 'shift_note', NOTE_ID, 'Towels low', {
      fetch: fetch as never,
    });
    expect(rows[0]).toMatchObject({ status: 'failed' });
  });
});
