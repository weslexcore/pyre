// Jev classification: the questions come from the shared registry, one
// boolean per signal type, and the answers come back as probabilities keyed
// by type. The AI SDK's mock evaluation model stands in for Jev.

import { SIGNAL_DEFINITIONS } from '@pyre/signals-core';
import { Experimental_EvaluationMockModelV4 as MockEvaluationModel } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { classifyText, JEV_MODEL } from '../agent/lib/classify/classify';
import { classifyQuestions, classifyState } from '../agent/lib/classify/questions';

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
          false: expect.any(String),
        },
      });
    }
  });

  it('hands Jev the subject context and the cleaned text', () => {
    expect(classifyState('shift_note', '  Towels low\u0007 ')).toMatchObject({
      kind: 'shift note',
      text: 'Towels low',
    });
  });
});

describe('classifyText', () => {
  const answers = Object.fromEntries(
    SIGNAL_DEFINITIONS.map((d, i) => [d.key, { type: 'boolean' as const, probability: i / 10 }])
  );

  it('evaluates the questions against the note and returns the probabilities', async () => {
    const calls: unknown[] = [];
    const model = new MockEvaluationModel({
      doEvaluate: async (options) => {
        calls.push(options);
        return { answers, warnings: [] };
      },
    });

    const result = await classifyText('shift_note', 'Heater is out', { model });

    expect(result.model).toBe(JEV_MODEL);
    expect(result.probabilities).toEqual(
      Object.fromEntries(SIGNAL_DEFINITIONS.map((d, i) => [d.key, i / 10]))
    );
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
    await expect(classifyText('shift_note', 'x', { model: down })).rejects.toThrow(/503/);

    const { action: _missing, ...partial } = answers;
    const incomplete = new MockEvaluationModel({
      doEvaluate: async () => ({ answers: partial, warnings: [] }),
    });
    await expect(classifyText('shift_note', 'x', { model: incomplete })).rejects.toThrow();
  });
});
