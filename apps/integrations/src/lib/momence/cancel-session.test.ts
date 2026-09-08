import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The probe behind the special-event conflict check's one write. What it
// must get right: a 404/405 means "try the next verb", anything else means
// "stop and report", a working route is remembered, and a pinned route is
// never second-guessed.

vi.mock('@pyre/webhook-core', () => ({
  createWebhookLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
  getRedis: () => null,
}));
vi.mock('@/lib/webhooks/momence', () => ({ getHostAccessToken: async () => 'token' }));

const { cancelHostSession, cancelRouteStatus, resetCancelRouteMemo } = await import('./host-api');

type Call = { method: string; url: string };

/** Answers each request from a script keyed by "METHOD path", 404 otherwise. */
function fakeFetch(script: Record<string, number>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = new URL(url).pathname.replace('/api/v2', '');
    calls.push({ method, url: path });
    const status = script[`${method} ${path}`] ?? 404;
    return new Response(status === 204 ? null : JSON.stringify({ ok: status < 400 }), { status });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

describe('cancelHostSession', () => {
  beforeEach(() => {
    resetCancelRouteMemo();
    vi.stubEnv('MOMENCE_SESSION_CANCEL_ROUTE', '');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('walks the candidates past 404s and remembers the one that worked', async () => {
    const calls = fakeFetch({ 'DELETE /host/sessions/42': 204 });
    expect(cancelRouteStatus()).toBe('unknown');

    const result = await cancelHostSession(42);

    expect(result).toEqual({ outcome: 'cancelled', via: 'DELETE /host/sessions/{id}' });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /host/sessions/42/cancel',
      'PUT /host/sessions/42/cancel',
      'DELETE /host/sessions/42',
    ]);
    expect(cancelRouteStatus()).toBe('supported');

    // The next call goes straight to the route that worked.
    calls.length = 0;
    await cancelHostSession(43);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['DELETE /host/sessions/43']);
  });

  it('treats 405 like 404 and reports unsupported when nothing answers', async () => {
    const calls = fakeFetch({ 'POST /host/sessions/42/cancel': 405 });
    const result = await cancelHostSession(42);
    expect(result.outcome).toBe('unsupported');
    expect(calls).toHaveLength(3);
    expect(cancelRouteStatus()).toBe('unsupported');

    // Remembered: no more probing on this instance.
    calls.length = 0;
    expect((await cancelHostSession(42)).outcome).toBe('unsupported');
    expect(calls).toHaveLength(0);
  });

  it('stops at the first real refusal instead of trying other verbs', async () => {
    const calls = fakeFetch({ 'POST /host/sessions/42/cancel': 409 });
    const result = await cancelHostSession(42);
    expect(result).toMatchObject({ outcome: 'error', status: 409 });
    expect(calls).toHaveLength(1);
    expect(cancelRouteStatus()).toBe('unknown');
  });

  it('uses only the pinned route, and never learns unsupported from it', async () => {
    vi.stubEnv('MOMENCE_SESSION_CANCEL_ROUTE', 'put /host/sessions/{id}/cancel');
    expect(cancelRouteStatus()).toBe('supported');

    const calls = fakeFetch({});
    const result = await cancelHostSession(42);
    expect(result).toEqual({
      outcome: 'unsupported',
      tried: ['PUT /host/sessions/{id}/cancel'],
    });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['PUT /host/sessions/42/cancel']);
    expect(cancelRouteStatus()).toBe('supported');
  });

  it('ignores a malformed pin and probes as usual', async () => {
    vi.stubEnv('MOMENCE_SESSION_CANCEL_ROUTE', 'cancel it somehow');
    const calls = fakeFetch({ 'POST /host/sessions/42/cancel': 200 });
    expect(cancelRouteStatus()).toBe('unknown');
    expect((await cancelHostSession(42)).outcome).toBe('cancelled');
    expect(calls).toHaveLength(1);
  });
});
