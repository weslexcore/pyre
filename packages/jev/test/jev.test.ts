// askJev hands the state and questions to the evaluation model untouched;
// askJevBooleans reduces the answers to probabilities and refuses a partial
// answer. The AI SDK's mock evaluation model stands in for Jev.

import { Experimental_EvaluationMockModelV4 as MockEvaluationModel } from 'ai/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { askJev, askJevBooleans, jevAvailable } from '../src';

const QUESTIONS = {
  urgent: { type: 'boolean', instructions: 'Does this need attention today?' },
  refund: { type: 'boolean', instructions: 'Is the guest asking for a refund?' },
} as const;

function mock(answers: Record<string, unknown>) {
  const calls: Array<{ state: unknown; questions: unknown }> = [];
  const model = new MockEvaluationModel({
    doEvaluate: async (options) => {
      calls.push(options);
      return { answers: answers as never, warnings: [] };
    },
  });
  return { model, calls };
}

describe('askJev', () => {
  it('evaluates the questions against the state', async () => {
    const { model, calls } = mock({
      urgent: { type: 'boolean', probability: 0.9 },
      refund: { type: 'boolean', probability: 0.1 },
    });
    const result = await askJev({ text: 'Heater is out' }, QUESTIONS, { model });
    expect(result.answers.urgent).toEqual({ type: 'boolean', probability: 0.9 });
    expect(calls[0]?.state).toEqual({ text: 'Heater is out' });
    expect(Object.keys(calls[0]?.questions as object)).toEqual(['urgent', 'refund']);
  });
});

describe('askJevBooleans', () => {
  it('returns P(true) keyed by question', async () => {
    const { model } = mock({
      urgent: { type: 'boolean', probability: 0.9 },
      refund: { type: 'boolean', probability: 0.1 },
    });
    await expect(askJevBooleans('Heater is out', QUESTIONS, { model })).resolves.toEqual({
      urgent: 0.9,
      refund: 0.1,
    });
  });

  it('fails when Jev fails or leaves a question unanswered', async () => {
    const down = new MockEvaluationModel({
      doEvaluate: async () => {
        throw new Error('Gateway 503');
      },
    });
    await expect(askJevBooleans('x', QUESTIONS, { model: down })).rejects.toThrow(/503/);

    const { model } = mock({ urgent: { type: 'boolean', probability: 0.9 } });
    await expect(askJevBooleans('x', QUESTIONS, { model })).rejects.toThrow();
  });
});

describe('jevAvailable', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('needs a Gateway key or a Vercel deployment', () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    vi.stubEnv('VERCEL', '');
    expect(jevAvailable()).toBe(false);
    expect(jevAvailable('gw-key')).toBe(true);
    vi.stubEnv('VERCEL', '1');
    expect(jevAvailable()).toBe(true);
  });
});
