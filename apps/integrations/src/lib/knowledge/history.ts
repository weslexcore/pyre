// A staff member's own conversation history with the knowledge assistant,
// as the Ask page's sidebar shows it. The rows come from the assistant's
// audit log (public.knowledge_queries, written by pyre-agents): one row per
// question, keyed by the Eve session it was asked in, so a conversation is
// simply every row sharing a session id. Client-bundle-safe (types + pure
// helpers); the reads live in /api/admin/knowledge-history.

/** One conversation in the sidebar list. */
export interface ConversationSummary {
  sessionId: string;
  /** The first question asked, shortened for a list row. */
  title: string;
  startedAt: string;
  /** When the latest question in it was asked — the list sorts by this. */
  lastAt: string;
  turnCount: number;
}

/** One question and its answer, as the log recorded them. */
export interface ConversationTurn {
  id: string;
  question: string;
  answer: string | null;
  status: 'pending' | 'answered' | 'failed' | 'cancelled';
  error: string | null;
  askedAt: string;
}

/** What the list endpoint reads per row. */
export interface HistoryRow {
  session_id: string;
  question: string;
  asked_at: string;
}

/** Sidebar rows are one line; anything past this is cut with an ellipsis. */
export const TITLE_MAX_LENGTH = 80;

/** The first line of a question, trimmed to fit a list row. */
export function conversationTitle(question: string): string {
  const firstLine = question.trim().split(/\r?\n/)[0]?.trim() ?? '';
  if (!firstLine) return 'Untitled conversation';
  if (firstLine.length <= TITLE_MAX_LENGTH) return firstLine;
  return `${firstLine.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

/**
 * Fold log rows (any order) into conversations, newest activity first. The
 * title is the earliest question that was actually recorded — the agent
 * writes the question a beat after the row, so a row can briefly be blank.
 */
export function groupConversations(rows: HistoryRow[], limit = 100): ConversationSummary[] {
  const byTitleSource = new Map<string, { at: string; question: string }>();
  const groups = new Map<string, ConversationSummary>();

  for (const row of rows) {
    const existing = groups.get(row.session_id);
    if (existing) {
      if (row.asked_at < existing.startedAt) existing.startedAt = row.asked_at;
      if (row.asked_at > existing.lastAt) existing.lastAt = row.asked_at;
      existing.turnCount += 1;
    } else {
      groups.set(row.session_id, {
        sessionId: row.session_id,
        title: '',
        startedAt: row.asked_at,
        lastAt: row.asked_at,
        turnCount: 1,
      });
    }
    if (row.question.trim()) {
      const source = byTitleSource.get(row.session_id);
      if (!source || row.asked_at < source.at) {
        byTitleSource.set(row.session_id, { at: row.asked_at, question: row.question });
      }
    }
  }

  const conversations = [...groups.values()].map((group) => ({
    ...group,
    title: conversationTitle(byTitleSource.get(group.sessionId)?.question ?? ''),
  }));
  conversations.sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
  return conversations.slice(0, limit);
}
