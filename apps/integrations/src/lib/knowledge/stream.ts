// The reduced event feed between /api/admin/knowledge-ask and the Ask
// island: the pyre-agents session stream boiled down to answer text, the
// assistant's trail (narration, tool calls and their results), and one
// terminal event that says where the island should resume from.
// Client-bundle-safe (types + a pure reducer).

import { serializeToolOutput } from './trail';

export interface AskToolCall {
  callId: string;
  tool: string;
  input: Record<string, unknown>;
}

export type AskStreamEvent =
  /** The text so far of the assistant block being written (accumulated from deltas). */
  | { type: 'delta'; text: string }
  /** One assistant block finished; 'stop' marks the answer, anything else is narration before a tool call. */
  | { type: 'message'; text: string; finishReason: string }
  /** A completed reasoning block, when the model exposes one. */
  | { type: 'thought'; text: string }
  /** The assistant called tools. */
  | { type: 'activity'; calls: AskToolCall[] }
  /** One tool call finished; output is serialised and capped. */
  | {
      type: 'result';
      callId: string;
      status: 'completed' | 'failed';
      output?: string;
      error?: string;
    }
  /**
   * The proxy stopped. 'waiting' = the answer is complete and the session
   * takes follow-ups; 'failed' = the turn errored; 'gone' = the session
   * ended; 'timeout' = the function budget ran out mid-answer — resume from
   * nextIndex.
   */
  | {
      type: 'done';
      status: 'waiting' | 'failed' | 'gone' | 'timeout';
      nextIndex: number;
      error?: string;
    };

export interface UpstreamEvent {
  type?: string;
  data?: Record<string, unknown>;
}

/** Reasoning blocks past this are cut; the trail wants the gist, not the transcript. */
const THOUGHT_MAX_LENGTH = 4000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Per-stream state: the text of the assistant block being written. Eve's
 * `message.appended` carries only the new text (`messageDelta`, eve ≥ 0.50),
 * while the island renders the block so far, so the proxy keeps one of these
 * per stream and the reducer accumulates into it. A stream picked up mid-block
 * starts from the resume point; the block's `message.completed` then carries
 * the authoritative text.
 */
export interface StreamReducerState {
  blockText: string;
}

export function createStreamReducerState(): StreamReducerState {
  return { blockText: '' };
}

/** Reduce one upstream Eve event to what the island needs, or null to skip it. */
export function reduceStreamEvent(
  event: UpstreamEvent,
  nextIndex: number,
  state: StreamReducerState = createStreamReducerState()
): AskStreamEvent | null {
  const data = event.data ?? {};
  switch (event.type) {
    case 'message.appended': {
      if (typeof data.messageDelta !== 'string' || !data.messageDelta) return null;
      state.blockText += data.messageDelta;
      return { type: 'delta', text: state.blockText };
    }
    case 'message.completed':
      state.blockText = '';
      return {
        type: 'message',
        text: typeof data.message === 'string' ? data.message : '',
        finishReason: typeof data.finishReason === 'string' ? data.finishReason : 'stop',
      };
    case 'reasoning.completed': {
      const text = typeof data.reasoning === 'string' ? data.reasoning.trim() : '';
      return text ? { type: 'thought', text: text.slice(0, THOUGHT_MAX_LENGTH) } : null;
    }
    case 'actions.requested': {
      const actions = Array.isArray(data.actions) ? data.actions.filter(isRecord) : [];
      const calls = actions
        .filter((a) => a.kind === 'tool-call' && typeof a.toolName === 'string')
        .map<AskToolCall>((a) => ({
          callId: typeof a.callId === 'string' ? a.callId : '',
          tool: a.toolName as string,
          input: isRecord(a.input) ? a.input : {},
        }));
      return calls.length > 0 ? { type: 'activity', calls } : null;
    }
    case 'action.result': {
      const result = isRecord(data.result) ? data.result : null;
      if (result?.kind !== 'tool-result' || typeof result.callId !== 'string') return null;
      const error = isRecord(data.error) ? data.error : null;
      const failed =
        data.status === 'failed' || data.status === 'rejected' || result.isError === true;
      return {
        type: 'result',
        callId: result.callId,
        status: failed ? 'failed' : 'completed',
        output: serializeToolOutput(result.output),
        ...(failed
          ? {
              error:
                error && typeof error.message === 'string'
                  ? error.message
                  : data.status === 'rejected'
                    ? 'The call was not allowed'
                    : 'The tool failed',
            }
          : {}),
      };
    }
    case 'turn.started':
      state.blockText = '';
      return null;
    case 'session.waiting':
      return { type: 'done', status: 'waiting', nextIndex };
    case 'turn.failed':
    case 'session.failed':
    case 'input.requested':
      return {
        type: 'done',
        status: 'failed',
        nextIndex,
        error: typeof data.message === 'string' ? data.message : 'The assistant hit an error',
      };
    case 'session.completed':
      return { type: 'done', status: 'gone', nextIndex };
    default:
      return null;
  }
}

/**
 * Reattaching to a conversation whose latest turn may still be running — the
 * person sent a message, left the page, and came back. The proxy replays the
 * session from its first event and this keeps only the newest turn: each
 * `turn.started` drops what was gathered so far, and nothing is emitted until
 * the replay reaches `until` (the session's event count when the read began),
 * at which point the newest turn goes out in one burst and the stream carries
 * on live. Runs of deltas collapse to the last one, since each carries the
 * block so far.
 */
export interface CatchUpState {
  until: number;
  buffer: AskStreamEvent[];
  caughtUp: boolean;
}

export function createCatchUpState(until: number): CatchUpState {
  return { until, buffer: [], caughtUp: until <= 0 };
}

/**
 * Feed one upstream event (`index` is how many events have been read,
 * counting this one) and its reduction; returns the events to emit now.
 */
export function catchUpEvent(
  state: CatchUpState,
  event: UpstreamEvent,
  index: number,
  reduced: AskStreamEvent | null
): AskStreamEvent[] {
  if (state.caughtUp) return reduced ? [reduced] : [];
  if (event.type === 'turn.started') {
    state.buffer = [];
  } else if (reduced) {
    const last = state.buffer[state.buffer.length - 1];
    if (reduced.type === 'delta' && last?.type === 'delta') {
      state.buffer[state.buffer.length - 1] = reduced;
    } else {
      state.buffer.push(reduced);
    }
  }
  if (index < state.until) return [];
  state.caughtUp = true;
  const out = state.buffer;
  state.buffer = [];
  return out;
}
