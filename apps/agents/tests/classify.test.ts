// Jev classification: the questions come from the shared registry, the
// Gateway request is the evaluation protocol @ai-sdk/gateway speaks, and a
// malformed answer fails the whole call rather than storing a partial one.

import { SIGNAL_DEFINITIONS } from '@pyre/signals-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyText } from '../agent/lib/classify/classify';
import { classifyQuestions, classifyState } from '../agent/lib/classify/questions';
import { JEV_MODEL } from '../agent/lib/jev';

describe('classifyQuestions', () => {
  it('asks one boolean question per signal the subject looks for', () => {
    const questions = classifyQuestions('shift_note');
    expect(Object.keys(questions)).toEqual(SIGNAL_DEFINITIONS.map((d) => d.key));
    for (const d of SIGNAL_DEFINITIONS) {
      const q = questions[d.key];
      expect(q.type).toBe('boolean');
      expect(q.instructions).toContain(d.definition);
      expect(q.criteria?.true).toEqual({ means: d.definition, examples: d.examples });
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
  beforeEach(() => vi.stubEnv('AI_GATEWAY_API_KEY', 'gw-key'));
  afterEach(() => vi.unstubAllEnvs());

  const answers = Object.fromEntries(
    SIGNAL_DEFINITIONS.map((d, i) => [d.key, { type: 'boolean', probability: i / 10 }])
  );

  it('posts the evaluation protocol to AI Gateway and returns the probabilities', async () => {
    const fetch = vi.fn(async () => Response.json({ answers }));
    const result = await classifyText('shift_note', 'Heater is out', { fetch: fetch as never });

    expect(result.model).toBe(JEV_MODEL);
    expect(result.probabilities).toEqual(
      Object.fromEntries(SIGNAL_DEFINITIONS.map((d, i) => [d.key, i / 10]))
    );
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ai-gateway.vercel.sh/v4/ai/evaluation-model');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer gw-key');
    expect(headers['ai-gateway-auth-method']).toBe('api-key');
    expect(headers['ai-model-id']).toBe('typesafe-ai/jev');
    expect(headers['ai-evaluation-model-specification-version']).toBe('4');
    const body = JSON.parse(init.body as string);
    expect(body.state.text).toBe('Heater is out');
    expect(Object.keys(body.questions)).toEqual(SIGNAL_DEFINITIONS.map((d) => d.key));
  });

  it('fails on an HTTP error or a missing / out-of-range answer', async () => {
    await expect(
      classifyText('shift_note', 'x', {
        fetch: (async () => new Response('nope', { status: 503 })) as never,
      })
    ).rejects.toThrow(/HTTP 503/);
    await expect(
      classifyText('shift_note', 'x', {
        fetch: (async () =>
          Response.json({ answers: { ...answers, action: { type: 'boolean', probability: 2 } } })) as never,
      })
    ).rejects.toThrow(/action/);
  });
});
