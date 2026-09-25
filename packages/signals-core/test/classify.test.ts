// Jev classification: the questions come from the shared registry, one
// boolean per signal type, and the answers come back as the signals that
// clear their thresholds. The AI SDK's mock evaluation model stands in for Jev.

import { JEV_MODEL } from '@pyre/jev';
import { Experimental_EvaluationMockModelV4 as MockEvaluationModel } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { classifyQuestions, classifySignals, classifyState, SIGNAL_DEFINITIONS } from '../src';

describe('classifyQuestions', () => {
  it('asks one boolean question per signal the subject looks for', () => {
    const questions = classifyQuestions('shift_note');
    expect(Object.keys(questions)).toEqual(SIGNAL_DEFINITIONS.map((d) => d.key));
    for (const d of SIGNAL_DEFINITIONS) {
      expect(questions[d.key]).toEqual({
        type: 'boolean',
        instructions: expect.stringContaining(d.definition),
        criteria: {
          true: { means: d.definition, examples: d.examples },
          false: expect.anything(),
        },
      });
    }
  });

  it('tells the model that work already done is not an action', () => {
    const { criteria } = classifyQuestions('shift_note').action;
    expect(criteria?.false).toEqual({
      means: expect.stringContaining('already done'),
      examples: expect.arrayContaining(['Restocked the towels and eucalyptus oil before close.']),
    });
  });

  it('hands Jev the subject context and the cleaned text', () => {
    expect(classifyState('shift_note', '  Towels low\u0007 ')).toMatchObject({
      kind: 'shift note',
      text: 'Towels low',
    });
  });
});

describe('classifySignals', () => {
  const PROBABILITIES = { action: 0.82, question: 0.1, update: 0.05, feedback: 0.2, safety: 0.4 };
  const answers = Object.fromEntries(
    Object.entries(PROBABILITIES).map(([k, p]) => [k, { type: 'boolean' as const, probability: p }])
  );

  it('asks about the note and keeps what clears each threshold', async () => {
    const calls: unknown[] = [];
    const model = new MockEvaluationModel({
      doEvaluate: async (options) => {
        calls.push(options);
        return { answers, warnings: [] };
      },
    });

    const result = await classifySignals('shift_note', 'Heater is out', { model });

    expect(result.model).toBe(JEV_MODEL);
    // safety's threshold is 0.35, so 0.4 counts; everything else needs 0.5.
    expect(result.signals).toEqual([
      { type: 'action', probability: 0.82 },
      { type: 'safety', probability: 0.4 },
    ]);
    const call = calls[0] as { state: { text: string }; questions: Record<string, unknown> };
    expect(call.state.text).toBe('Heater is out');
    expect(Object.keys(call.questions)).toEqual(SIGNAL_DEFINITIONS.map((d) => d.key));
  });

  it('fails when Jev fails or leaves a question unanswered', async () => {
    const down = new MockEvaluationModel({
      doEvaluate: async () => {
        throw new Error('Gateway 503');
      },
    });
    await expect(classifySignals('shift_note', 'x', { model: down })).rejects.toThrow(/503/);

    const { action: _missing, ...partial } = answers;
    const incomplete = new MockEvaluationModel({
      doEvaluate: async () => ({ answers: partial, warnings: [] }),
    });
    await expect(classifySignals('shift_note', 'x', { model: incomplete })).rejects.toThrow();
  });
});
