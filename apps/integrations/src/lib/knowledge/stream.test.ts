import { describe, expect, it } from 'vitest';
import { reduceStreamEvent } from './stream';

describe('reduceStreamEvent', () => {
  it('forwards cumulative answer text as it streams', () => {
    expect(
      reduceStreamEvent(
        { type: 'message.appended', data: { messageDelta: ' tub', messageSoFar: 'Left tub' } },
        3
      )
    ).toEqual({ type: 'delta', text: 'Left tub' });
  });

  it('marks completed blocks with their finish reason', () => {
    expect(
      reduceStreamEvent(
        {
          type: 'message.completed',
          data: { message: 'Let me check.', finishReason: 'tool-calls' },
        },
        4
      )
    ).toEqual({ type: 'message', text: 'Let me check.', finishReason: 'tool-calls' });
  });

  it('reports the tools a step called, skipping non-tool actions', () => {
    expect(
      reduceStreamEvent(
        {
          type: 'actions.requested',
          data: {
            actions: [
              { kind: 'load-skill', callId: 'a' },
              { kind: 'tool-call', callId: 'b', toolName: 'search_knowledge_base' },
              { kind: 'tool-call', callId: 'c', toolName: 'read_sop' },
            ],
          },
        },
        5
      )
    ).toEqual({ type: 'activity', tools: ['search_knowledge_base', 'read_sop'] });
    expect(
      reduceStreamEvent(
        { type: 'actions.requested', data: { actions: [{ kind: 'load-skill' }] } },
        5
      )
    ).toBeNull();
  });

  it('terminates on the turn boundary with the resume index', () => {
    expect(
      reduceStreamEvent({ type: 'session.waiting', data: { continuationToken: 'x' } }, 9)
    ).toEqual({
      type: 'done',
      status: 'waiting',
      nextIndex: 9,
    });
    expect(reduceStreamEvent({ type: 'turn.failed', data: { message: 'boom' } }, 9)).toEqual({
      type: 'done',
      status: 'failed',
      nextIndex: 9,
      error: 'boom',
    });
    expect(reduceStreamEvent({ type: 'session.completed' }, 9)).toEqual({
      type: 'done',
      status: 'gone',
      nextIndex: 9,
    });
  });

  it('ignores everything else', () => {
    expect(
      reduceStreamEvent({ type: 'reasoning.appended', data: { reasoningSoFar: 'hmm' } }, 1)
    ).toBeNull();
    expect(reduceStreamEvent({ type: 'step.started' }, 1)).toBeNull();
    expect(reduceStreamEvent({}, 1)).toBeNull();
  });
});
