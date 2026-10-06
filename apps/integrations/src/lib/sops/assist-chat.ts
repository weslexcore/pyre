// The chat in the SOP writing assistant (components/admin/SopAssist): the
// assistant's open questions asked one at a time, the editor's answers, and
// when to send them back. A round starts when a proposal arrives with
// questions: the first is asked, the rest wait in the queue, and each answer
// (or skip) brings up the next. Once the queue is empty, the answers go to
// the assistant as a refine call, whose reply and follow-up questions start
// the next round. With nothing queued, a message from the editor is a
// request ("make step 3 required") and goes straight out. Pure and
// client-bundle-safe.

import { MAX_ASSIST_CHAT_MESSAGES } from './assist-limits';

export interface ChatMessage {
  role: 'assistant' | 'user';
  text: string;
  /** The editor passed on this question; it stays TBD. */
  skipped?: boolean;
}

export interface ChatState {
  messages: ChatMessage[];
  /** Questions not yet asked this round, in order. */
  queue: string[];
  /** The last message is a question waiting for the editor's answer. */
  asking: boolean;
}

export const EMPTY_CHAT: ChatState = { messages: [], queue: [], asking: false };

/** What a skipped question reads as, to the assistant. */
export const SKIPPED_ANSWER = '(skipped)';

/**
 * Start a round: the assistant's reply (if any), then the first of the
 * questions it has not asked before. Repeats of earlier questions are dropped,
 * so a model that re-asks never loops the editor.
 */
export function openRound(state: ChatState, reply: string | null, questions: string[]): ChatState {
  const asked = new Set(
    state.messages.filter((m) => m.role === 'assistant').map((m) => m.text.trim().toLowerCase())
  );
  const fresh = questions.map((q) => q.trim()).filter((q) => q && !asked.has(q.toLowerCase()));
  const messages = [...state.messages];
  if (reply?.trim()) messages.push({ role: 'assistant', text: reply.trim() });
  const [first, ...rest] = fresh;
  if (first) messages.push({ role: 'assistant', text: first });
  return { messages, queue: rest, asking: Boolean(first) };
}

/**
 * The editor says something: an answer to the open question, or a request
 * when nothing is asked. Returns the next state and whether it is time to
 * send: this round's questions are all answered, or there were none.
 */
export function reply(
  state: ChatState,
  text: string,
  opts: { skipped?: boolean } = {}
): { state: ChatState; send: boolean } {
  const message: ChatMessage = opts.skipped
    ? { role: 'user', text: SKIPPED_ANSWER, skipped: true }
    : { role: 'user', text: text.trim() };
  const messages = [...state.messages, message];
  const [next, ...rest] = state.queue;
  if (next) {
    return {
      state: {
        messages: [...messages, { role: 'assistant', text: next }],
        queue: rest,
        asking: true,
      },
      send: false,
    };
  }
  return { state: { messages, queue: [], asking: false }, send: true };
}

/**
 * Send before the round is through. The open question and the unasked ones
 * stay TBD; the assistant may bring them up again in its next round.
 */
export function sendEarly(state: ChatState): ChatState {
  return { ...state, queue: [], asking: false };
}

/** Whether the editor has said anything the assistant has not seen yet. */
export function hasUnsentReplies(state: ChatState, sentThrough: number): boolean {
  return state.messages.slice(sentThrough).some((m) => m.role === 'user');
}

/** The chat as a refine call carries it: the most recent messages, within the API's bound. */
export function toConversation(state: ChatState): { role: 'assistant' | 'user'; text: string }[] {
  return state.messages.slice(-MAX_ASSIST_CHAT_MESSAGES).map(({ role, text }) => ({ role, text }));
}
