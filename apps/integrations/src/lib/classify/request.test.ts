// The background run behind every shift note write: it skips unchanged text,
// files its request before asking Jev, and never lets a stale run overwrite a
// newer one. Scheduling it is ./dispatch (dispatch.test.ts). The AI SDK's
// mock evaluation model stands in for Jev.
import { Experimental_EvaluationMockModelV4 as MockEvaluationModel } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeClassificationsDb } from './fake-db.test-helper';

const { contentHash, runClassification } = await import('./request');

const NOTE_ID = '11111111-1111-4111-8111-111111111111';

const PROBABILITIES = { action: 0.82, question: 0.1, update: 0.05, feedback: 0.2, safety: 0.01 };

/** A Jev stand-in answering with `probabilities` (or throwing), counting its calls. */
function jev(answer: () => Record<string, unknown> = () => PROBABILITIES) {
  const model = new MockEvaluationModel({
    doEvaluate: async () => {
      model.calls++;
      const answers = Object.fromEntries(
        Object.entries(answer()).map(([k, p]) => [k, { type: 'boolean', probability: p }])
      );
      return { answers: answers as never, warnings: [] };
    },
  }) as MockEvaluationModel & { calls: number };
  model.calls = 0;
  return model;
}

describe('runClassification', () => {
  beforeEach(() => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'gw-key');
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('files a pending request, asks Jev, and stores what clears the thresholds', async () => {
    const { db, rows, log } = fakeClassificationsDb();
    const model = jev(() => {
      // The row must exist before the answer can be written against it.
      expect(log).toEqual(['upsert:pending']);
      return PROBABILITIES;
    });

    const view = await runClassification(db as never, 'shift_note', NOTE_ID, 'Towels low', {
      model,
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
    expect(model.calls).toBe(1);
  });

  it("records each saved answer in the note's activity, with who asked for it", async () => {
    const { db, inserted } = fakeClassificationsDb();
    await runClassification(db as never, 'shift_note', NOTE_ID, 'Towels low', {
      model: jev(),
      requestedBy: 'wes@pyresauna.com',
    });
    expect(inserted).toEqual([
      {
        table: 'shift_note_replies',
        row: {
          note_id: NOTE_ID,
          kind: 'classification',
          author_email: null,
          is_private: true,
          body: '',
          data: {
            signals: [{ type: 'action', probability: 0.82 }],
            model: 'typesafe-ai/jev',
            requested_by: 'wes@pyresauna.com',
          },
        },
      },
    ]);
  });

  it('does nothing when Jev cannot be reached', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    vi.stubEnv('VERCEL', '');
    const { db, rows } = fakeClassificationsDb();
    const model = jev();
    expect(
      await runClassification(db as never, 'shift_note', NOTE_ID, 'Towels low', { model })
    ).toBeNull();
    expect(rows).toEqual([]);
    expect(model.calls).toBe(0);
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
    const model = jev();

    const same = await runClassification(db as never, 'shift_note', NOTE_ID, '  Towels low ', {
      model,
    });
    expect(same?.signals).toEqual([{ type: 'action', probability: 0.9 }]);
    expect(model.calls).toBe(0);

    await runClassification(db as never, 'shift_note', NOTE_ID, 'Towels low', {
      force: true,
      model,
    });
    expect(model.calls).toBe(1);
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
    const failing = jev(() => {
      throw new Error('Gateway 503: Jev down');
    });

    const view = await runClassification(db as never, 'shift_note', NOTE_ID, 'Towels low', {
      model: failing,
    });
    expect(view?.state).toBe('failed');
    expect(rows[0]).toMatchObject({ attempts: 3, status: 'failed' });
    expect(rows[0]?.error).toMatch(/503.*Jev down/);

    await runClassification(db as never, 'shift_note', NOTE_ID, 'Heater is out', {
      model: failing,
    });
    expect(rows[0]?.attempts).toBe(1);
  });

  it('writes nothing when a newer run replaced this one mid-flight', async () => {
    const { db, rows, inserted } = fakeClassificationsDb();
    const model = jev(() => {
      // An edit lands while Jev is answering and rotates the request id.
      (rows[0] as Record<string, unknown>).request_id = 'newer';
      return PROBABILITIES;
    });
    const view = await runClassification(db as never, 'shift_note', NOTE_ID, 'Towels low', {
      model,
    });
    expect(view).toBeNull();
    expect(rows[0]?.status).toBe('pending');
    expect(inserted).toEqual([]);
  });

  it('marks an answer that fails validation as failed', async () => {
    const { db, rows, inserted } = fakeClassificationsDb();
    const model = jev(() => ({ ...PROBABILITIES, action: 7 }));
    await runClassification(db as never, 'shift_note', NOTE_ID, 'Towels low', { model });
    expect(rows[0]).toMatchObject({ status: 'failed' });
    expect(inserted).toEqual([]);
  });
});
