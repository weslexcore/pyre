import { describe, expect, it } from 'vitest';
import { classifyTailEvent } from './eve-session';

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
