// The reduced event feed between /api/admin/knowledge-ask and the Ask
// island: the pyre-agents session stream boiled down to answer text, an
// activity hint while tools run, and one terminal event that says where the
// island should resume from. Client-bundle-safe (types + a pure reducer).

export type AskStreamEvent =
  /** Cumulative text of the assistant block being written. */
  | { type: 'delta'; text: string }
  /** One assistant block finished; 'stop' marks the answer, anything else is narration before a tool call. */
  | { type: 'message'; text: string; finishReason: string }
  /** The assistant called tools; the island shows a line for the first. */
  | { type: 'activity'; tools: string[] }
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

/** Reduce one upstream Eve event to what the island needs, or null to skip it. */
export function reduceStreamEvent(event: UpstreamEvent, nextIndex: number): AskStreamEvent | null {
  const data = event.data ?? {};
  switch (event.type) {
    case 'message.appended':
      return typeof data.messageSoFar === 'string'
        ? { type: 'delta', text: data.messageSoFar }
        : null;
    case 'message.completed':
      return {
        type: 'message',
        text: typeof data.message === 'string' ? data.message : '',
        finishReason: typeof data.finishReason === 'string' ? data.finishReason : 'stop',
      };
    case 'actions.requested': {
      const actions = Array.isArray(data.actions)
        ? (data.actions as Array<Record<string, unknown>>)
        : [];
      const tools = actions
        .filter((a) => a.kind === 'tool-call' && typeof a.toolName === 'string')
        .map((a) => a.toolName as string);
      return tools.length > 0 ? { type: 'activity', tools } : null;
    }
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
