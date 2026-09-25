import { describe, expect, it } from 'vitest';
import { createStreamReducerState, reduceStreamEvent } from './stream';

describe('reduceStreamEvent', () => {
  it('accumulates delta-only appends into the text of the block so far', () => {
    const state = createStreamReducerState();
    const append = (messageDelta: string) =>
      reduceStreamEvent({ type: 'message.appended', data: { messageDelta } }, 3, state);
    expect(append('Left')).toEqual({ type: 'delta', text: 'Left' });
    expect(append(' tub')).toEqual({ type: 'delta', text: 'Left tub' });
    expect(append('')).toBeNull();
  });

  it('starts the next block fresh after a completed one', () => {
    const state = createStreamReducerState();
    reduceStreamEvent(
      { type: 'message.appended', data: { messageDelta: 'Let me check.' } },
      1,
      state
    );
    reduceStreamEvent(
      { type: 'message.completed', data: { message: 'Let me check.', finishReason: 'tool-calls' } },
      2,
      state
    );
    expect(
      reduceStreamEvent({ type: 'message.appended', data: { messageDelta: 'Yes' } }, 3, state)
    ).toEqual({ type: 'delta', text: 'Yes' });
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

  it('reports the tools a step called with their inputs, skipping non-tool actions', () => {
    expect(
      reduceStreamEvent(
        {
          type: 'actions.requested',
          data: {
            actions: [
              { kind: 'load-skill', callId: 'a' },
              {
                kind: 'tool-call',
                callId: 'b',
                toolName: 'search_knowledge_base',
                input: { query: 'shock' },
              },
              { kind: 'tool-call', callId: 'c', toolName: 'read_sop', input: { slug: 'closing' } },
            ],
          },
        },
        5
      )
    ).toEqual({
      type: 'activity',
      calls: [
        { callId: 'b', tool: 'search_knowledge_base', input: { query: 'shock' } },
        { callId: 'c', tool: 'read_sop', input: { slug: 'closing' } },
      ],
    });
    expect(
      reduceStreamEvent(
        { type: 'actions.requested', data: { actions: [{ kind: 'load-skill' }] } },
        5
      )
    ).toBeNull();
  });

  it('reports a tool result with its output serialised', () => {
    expect(
      reduceStreamEvent(
        {
          type: 'action.result',
          data: {
            status: 'completed',
            result: {
              kind: 'tool-result',
              callId: 'b',
              toolName: 'read_sop',
              output: { title: 'Closing' },
            },
          },
        },
        6
      )
    ).toEqual({
      type: 'result',
      callId: 'b',
      status: 'completed',
      output: '{\n  "title": "Closing"\n}',
    });
  });

  it('marks a failed tool result with its error', () => {
    expect(
      reduceStreamEvent(
        {
          type: 'action.result',
          data: {
            status: 'failed',
            error: { code: 'tool_error', message: 'timeout' },
            result: { kind: 'tool-result', callId: 'b', toolName: 'read_sop', output: 'x' },
          },
        },
        6
      )
    ).toEqual({ type: 'result', callId: 'b', status: 'failed', output: 'x', error: 'timeout' });
    expect(
      reduceStreamEvent(
        {
          type: 'action.result',
          data: {
            status: 'completed',
            result: { kind: 'load-skill-result', callId: 'z', output: null },
          },
        },
        6
      )
    ).toBeNull();
  });

  it('keeps a completed reasoning block as a thought', () => {
    expect(
      reduceStreamEvent({ type: 'reasoning.completed', data: { reasoning: ' Check the log. ' } }, 7)
    ).toEqual({ type: 'thought', text: 'Check the log.' });
    expect(
      reduceStreamEvent({ type: 'reasoning.completed', data: { reasoning: '  ' } }, 7)
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
