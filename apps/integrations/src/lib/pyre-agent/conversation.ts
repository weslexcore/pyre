// Which Pyre Agent conversation this browser has open, so leaving the page
// and coming back — or starting a routine with Run now on the routines page
// — lands in it. Kept in localStorage beside the ?c= URL parameter; the
// island (SopAsk) reads it on load. Client-only.

/** Which conversation is open, so leaving the page and coming back lands in it. */
export const STORAGE_KEY = 'pyre-agent:conversation';
/** The URL parameter naming the open conversation. */
export const CONVERSATION_PARAM = 'c';

export interface StoredConversation {
  /** The live agent session — the one a follow-up or a reattach goes to. */
  sessionId: string;
  /**
   * The conversation it belongs to (its first session), when that is a
   * different session: the conversation carried on after its session ended.
   */
  conversationId?: string;
  token: string;
  /** A question sent but maybe not logged yet — shown if the history has nothing. */
  pending?: string;
}

export function readStored(): StoredConversation | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredConversation>;
    return typeof value.sessionId === 'string' && typeof value.token === 'string'
      ? {
          sessionId: value.sessionId,
          token: value.token,
          pending: value.pending,
          ...(typeof value.conversationId === 'string'
            ? { conversationId: value.conversationId }
            : {}),
        }
      : null;
  } catch {
    return null;
  }
}

export function writeStored(value: StoredConversation | null): void {
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable (private mode): the URL still carries the conversation.
  }
}
