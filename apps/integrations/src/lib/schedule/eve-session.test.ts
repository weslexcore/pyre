import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyTailEvent, countEveSessionEvents } from './eve-session';

describe('classifyTailEvent', () => {
  it('reads the continuation token off a parked session', () => {
    expect(
      classifyTailEvent({ type: 'session.waiting', data: { continuationToken: 'eve:7f3c' } })
    ).toEqual({ state: 'waiting', continuationToken: 'eve:7f3c' });
  });

  it('treats a waiting event without a token as gone (nothing to resume with)', () => {
    expect(classifyTailEvent({ type: 'session.waiting', data: {} })).toEqual({ state: 'gone' });
  });

  it.each(['session.completed', 'session.failed'])('%s means the session is gone', (type) => {
    expect(classifyTailEvent({ type })).toEqual({ state: 'gone' });
  });

  it.each(['turn.started', 'message.appended', 'action.result', 'step.completed'])(
    'a mid-turn tail event (%s) means the session is running',
    (type) => {
      expect(classifyTailEvent({ type })).toEqual({ state: 'running' });
    }
  );

  it('treats malformed events as gone', () => {
    expect(classifyTailEvent(null)).toEqual({ state: 'gone' });
    expect(classifyTailEvent({})).toEqual({ state: 'gone' });
    expect(classifyTailEvent('session.waiting')).toEqual({ state: 'gone' });
  });
});

describe('countEveSessionEvents', () => {
  const config = { baseUrl: 'https://agents.test', channelSecret: 'secret' };

  function ndjsonResponse(lines: string[], keepOpen = false): Response {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`${lines.join('\n')}\n`));
        if (!keepOpen) controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  }

  const waiting = (token: string) =>
    JSON.stringify({ type: 'session.waiting', data: { continuationToken: token } });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('counts events up to and including the waiting event for the current token', async () => {
    const lines = [
      '{"type":"turn.started"}',
      '{"type":"message.appended","data":{"messageSoFar":"Hi"}}',
      waiting('eve:turn-1'),
      '{"type":"turn.started"}',
      '',
      '{"type":"message.completed","data":{"message":"Answer"}}',
      waiting('eve:turn-2'),
    ];
    const fetchMock = vi.fn(async () => ndjsonResponse(lines, true));
    vi.stubGlobal('fetch', fetchMock);

    await expect(countEveSessionEvents(config, 'ses_1', 'eve:turn-2')).resolves.toBe(6);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://agents.test/eve/v1/session/ses_1/stream?startIndex=0');
  });

  it('stops at the first turn when that is the current one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ndjsonResponse(['{"type":"turn.started"}', waiting('eve:turn-1')]))
    );
    await expect(countEveSessionEvents(config, 'ses_1', 'eve:turn-1')).resolves.toBe(2);
  });

  it('is null when the log ends without the current waiting event', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ndjsonResponse(['{"type":"turn.started"}', waiting('eve:stale')]))
    );
    await expect(countEveSessionEvents(config, 'ses_1', 'eve:turn-2')).resolves.toBeNull();
  });

  it('is null when the session cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 }))
    );
    await expect(countEveSessionEvents(config, 'ses_1', 'eve:turn-1')).resolves.toBeNull();
  });
});
