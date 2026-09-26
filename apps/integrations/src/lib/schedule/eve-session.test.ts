import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyTailEvent, countEveSessionEvents, sendEveFollowUp } from './eve-session';

describe('classifyTailEvent', () => {
  it('reads a parked session as waiting', () => {
    expect(classifyTailEvent({ type: 'session.waiting', data: {} })).toEqual({ state: 'waiting' });
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
  afterEach(() => vi.restoreAllMocks());

  it('reads the event count off the tail-index header', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { headers: { 'x-eve-stream-tail-index': '41' } }));
    expect(await countEveSessionEvents(config, 'sess_1')).toBe(42);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      'https://agents.test/eve/v1/session/sess_1/stream?startIndex=-1&includeTailIndex=1'
    );
  });

  it('is null when the session cannot be read or the header is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 404 }));
    expect(await countEveSessionEvents(config, 'sess_1')).toBeNull();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(''));
    expect(await countEveSessionEvents(config, 'sess_1')).toBeNull();
  });
});

describe('sendEveFollowUp', () => {
  const config = { baseUrl: 'https://agents.test', channelSecret: 'secret' };
  afterEach(() => vi.restoreAllMocks());

  it('posts the message to the session id with no continuation token', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"ok":true}', { status: 202 }));
    expect(await sendEveFollowUp(config, 'sess_1', 'Swap Liz and Omar')).toEqual({ ok: true });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://agents.test/eve/v1/session/sess_1');
    expect(JSON.parse(init.body as string)).toEqual({ message: 'Swap Liz and Omar' });
  });

  it('reports an ended session as gone so the caller starts fresh', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ ok: false, code: 'session_not_active' }, { status: 409 })
    );
    expect(await sendEveFollowUp(config, 'sess_1', 'hi')).toEqual({ ok: false, reason: 'gone' });
  });

  it('retries a session whose inbox is still opening', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ code: 'session_not_ready' }, { status: 409 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 202 }));
    const sent = sendEveFollowUp(config, 'sess_1', 'hi');
    await vi.runAllTimersAsync();
    expect(await sent).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
