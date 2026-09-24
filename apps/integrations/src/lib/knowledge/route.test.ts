import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JEV_ENDPOINT, JEV_MODEL, parseAnswers } from './jev';
import {
  ASK_ROUTE_QUESTIONS,
  type AskRoute,
  classifyAskQuestion,
  decideAskRoute,
  HINT_THRESHOLD,
  OFF_TOPIC_THRESHOLD,
} from './route';

const ENV_KEYS = ['TYPESAFE_API_KEY', 'ASK_ROUTER_ENABLED'] as const;
const previous = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function jevResponse(inScope: number, domain: string, domainConfidence: number): Response {
  return new Response(
    JSON.stringify({
      model: JEV_MODEL,
      answers: {
        in_scope: { noul: inScope },
        domain: { choice: domain, probabilities: {}, confidence: domainConfidence },
      },
      usage: { input_tokens: 42 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  process.env.TYPESAFE_API_KEY = 'ts_test_key';
  process.env.ASK_ROUTER_ENABLED = 'true';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  for (const key of ENV_KEYS) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
});

describe('classifyAskQuestion', () => {
  it('reads a confident off-topic answer', async () => {
    fetchMock.mockResolvedValueOnce(jevResponse(0.02, 'off_topic', 0.97));
    const route = await classifyAskQuestion("What's the weather tomorrow?");
    expect(route).toMatchObject({
      inScope: false,
      inScopeConfidence: 0.98,
      domain: 'off_topic',
      domainConfidence: 0.97,
    });
    expect(route?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(decideAskRoute(route)).toBe('short_circuit');
  });

  it('reads an in-scope question with its domain, and sends the declared questions', async () => {
    fetchMock.mockResolvedValueOnce(jevResponse(0.95, 'water', 0.88));
    const route = await classifyAskQuestion('When was the left tub last shocked?');
    expect(route).toMatchObject({
      inScope: true,
      inScopeConfidence: 0.95,
      domain: 'water',
      domainConfidence: 0.88,
    });
    expect(decideAskRoute(route)).toEqual({ hint: 'water log' });

    const [url, rawInit] = fetchMock.mock.calls[0];
    const init = rawInit as RequestInit;
    expect(url).toBe(JEV_ENDPOINT);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ts_test_key');
    expect(JSON.parse(init.body as string)).toEqual({
      model: JEV_MODEL,
      state: 'When was the left tub last shocked?',
      questions: ASK_ROUTE_QUESTIONS,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns a low-confidence route that the decision passes straight through', async () => {
    fetchMock.mockResolvedValueOnce(jevResponse(0.4, 'off_topic', 0.55));
    const route = await classifyAskQuestion('pet parrots policy + draft the schedule');
    expect(route).toMatchObject({ inScope: false, domain: 'off_topic' });
    expect(route?.inScopeConfidence).toBeCloseTo(0.6);
    expect(decideAskRoute(route)).toBe('passthrough');
  });

  it('gives up (null) when Jev takes longer than the timeout', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        })
    );
    const pending = classifyAskQuestion('How hot is the sauna?');
    await vi.advanceTimersByTimeAsync(800);
    expect(await pending).toBeNull();
  });

  it('returns null on a non-200 response', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":"overloaded"}', { status: 503 }));
    expect(await classifyAskQuestion('How hot is the sauna?')).toBeNull();
  });

  it('returns null on a response it cannot read', async () => {
    fetchMock.mockResolvedValueOnce(jevResponse(0.9, 'weather', 0.9));
    expect(await classifyAskQuestion('How hot is the sauna?')).toBeNull();
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await classifyAskQuestion('How hot is the sauna?')).toBeNull();
  });

  it('returns null without calling Jev when there is no key', async () => {
    delete process.env.TYPESAFE_API_KEY;
    expect(await classifyAskQuestion('How hot is the sauna?')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null without calling Jev when the flag is off', async () => {
    process.env.ASK_ROUTER_ENABLED = 'false';
    expect(await classifyAskQuestion('How hot is the sauna?')).toBeNull();
    delete process.env.ASK_ROUTER_ENABLED;
    expect(await classifyAskQuestion('How hot is the sauna?')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('parseAnswers', () => {
  it('rejects a partial or out-of-range answer', () => {
    expect(parseAnswers({ answers: { in_scope: { noul: 0.5 } } }, ASK_ROUTE_QUESTIONS)).toBeNull();
    expect(
      parseAnswers(
        { answers: { in_scope: { noul: 1.5 }, domain: { choice: 'sop', confidence: 0.9 } } },
        ASK_ROUTE_QUESTIONS
      )
    ).toBeNull();
    expect(parseAnswers(null, ASK_ROUTE_QUESTIONS)).toBeNull();
  });
});

describe('decideAskRoute', () => {
  const route = (patch: Partial<AskRoute>): AskRoute => ({
    inScope: true,
    inScopeConfidence: 0.95,
    domain: 'sop',
    domainConfidence: 0.9,
    latencyMs: 90,
    ...patch,
  });
  const offTopic = (inScopeConfidence: number) =>
    route({ inScope: false, inScopeConfidence, domain: 'off_topic', domainConfidence: 0.95 });

  it('short-circuits at the off-topic threshold and not below it', () => {
    expect(OFF_TOPIC_THRESHOLD).toBe(0.9);
    expect(decideAskRoute(offTopic(0.9))).toBe('short_circuit');
    expect(decideAskRoute(offTopic(0.999))).toBe('short_circuit');
    expect(decideAskRoute(offTopic(0.89))).toBe('passthrough');
  });

  it('needs both answers to agree before short-circuiting', () => {
    // Sure it's out of scope, but the domain picked a real topic: let the agent decide.
    expect(
      decideAskRoute(route({ inScope: false, inScopeConfidence: 0.95, domain: 'schedule' }))
    ).toEqual({ hint: 'staff schedule' });
    // Domain says off-topic, but scope says it's ours.
    expect(decideAskRoute(route({ domain: 'off_topic', domainConfidence: 0.99 }))).toBe(
      'passthrough'
    );
  });

  it('hints at the domain threshold and not below it', () => {
    expect(HINT_THRESHOLD).toBe(0.7);
    expect(decideAskRoute(route({ domain: 'incident', domainConfidence: 0.7 }))).toEqual({
      hint: 'incident reports',
    });
    expect(decideAskRoute(route({ domain: 'shift_notes', domainConfidence: 0.99 }))).toEqual({
      hint: 'shift notes',
    });
    expect(decideAskRoute(route({ domain: 'incident', domainConfidence: 0.69 }))).toBe(
      'passthrough'
    );
  });

  it('passes through when unrouted or forced', () => {
    expect(decideAskRoute(null)).toBe('passthrough');
    expect(decideAskRoute(offTopic(0.99), { force: true })).toBe('passthrough');
    expect(decideAskRoute(route({}), { force: true })).toBe('passthrough');
  });
});
