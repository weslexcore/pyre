// The knowledge assistant's audit log (public.knowledge_queries): one row per
// question, keyed by (session, turn), carrying who asked, the access they
// had, the tools the assistant called, and the answer. Admins review it on
// /admin/ask/log.
//
// Rows are assembled from stream events by two writers that run in no
// guaranteed order — the Eve channel handlers in agent/channels/eve.ts (which
// know the session's auth, so they stamp asker and scope) and the hook in
// agent/hooks/knowledge_audit.ts (which sees the inbound message, so it
// records the question) — hence every write here is an upsert on
// (session_id, turn_id) touching only its own columns. Nothing in this file
// throws: a failed audit write is logged and the turn goes on, because a
// thrown handler would fail the staff member's question.

import { getDb } from '../db';
import type { KnowledgeScope } from '../role';

const TABLE = 'knowledge_queries';
const CONFLICT = 'session_id,turn_id';

/** The tool calls recorded per turn, in order. */
export interface AuditToolCall {
  tool: string;
  input: Record<string, unknown>;
}

const QUESTION_RE = /<staff-question>\s*([\s\S]*?)\s*<\/staff-question>/i;

/** The question a staff member typed, out of the message the dashboard wrapped it in. */
export function extractQuestion(message: string): string {
  const match = QUESTION_RE.exec(message);
  return (match ? match[1] : message).trim().slice(0, 2000);
}

function warn(step: string, error: unknown): void {
  console.warn(`[knowledge-audit] ${step} failed:`, error instanceof Error ? error.message : error);
}

/** A turn began: record who is asking and what they may see. */
export async function auditTurnStarted(
  sessionId: string,
  turnId: string,
  scope: KnowledgeScope
): Promise<void> {
  try {
    const { error } = await getDb()
      .from(TABLE)
      .upsert(
        {
          session_id: sessionId,
          turn_id: turnId,
          asked_by: scope.email,
          viewer_scope: scope,
          status: 'pending',
        },
        { onConflict: CONFLICT }
      );
    if (error) throw new Error(error.message);
  } catch (error) {
    warn('turn start', error);
  }
}

/**
 * The inbound message for a turn. Update-only: the hook that calls this
 * cannot see the session's role, and a scheduler session has no row to
 * update, so the update simply matches nothing there. One short retry covers
 * the handlers landing in the other order.
 */
export async function auditQuestion(
  sessionId: string,
  turnId: string,
  message: string
): Promise<void> {
  const question = extractQuestion(message);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await getDb()
        .from(TABLE)
        .update({ question })
        .eq('session_id', sessionId)
        .eq('turn_id', turnId)
        .select('id');
      if (error) throw new Error(error.message);
      if ((data ?? []).length > 0) return;
    } catch (error) {
      warn('question', error);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}

/** Tool calls the assistant requested; appended to the turn's list. */
export async function auditToolCalls(
  sessionId: string,
  turnId: string,
  calls: AuditToolCall[]
): Promise<void> {
  if (calls.length === 0) return;
  try {
    const db = getDb();
    const { data, error } = await db
      .from(TABLE)
      .select('id, tool_calls')
      .eq('session_id', sessionId)
      .eq('turn_id', turnId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return;
    const existing = Array.isArray(data.tool_calls) ? (data.tool_calls as AuditToolCall[]) : [];
    const { error: updateError } = await db
      .from(TABLE)
      .update({ tool_calls: [...existing, ...calls].slice(0, 50) })
      .eq('id', data.id);
    if (updateError) throw new Error(updateError.message);
  } catch (error) {
    warn('tool calls', error);
  }
}

/** A finished assistant block that is an answer (not narration before a tool call). */
export async function auditAnswer(sessionId: string, turnId: string, answer: string): Promise<void> {
  try {
    const { error } = await getDb()
      .from(TABLE)
      .update({ answer })
      .eq('session_id', sessionId)
      .eq('turn_id', turnId);
    if (error) throw new Error(error.message);
  } catch (error) {
    warn('answer', error);
  }
}

/** The turn's outcome. */
export async function auditOutcome(
  sessionId: string,
  turnId: string,
  status: 'answered' | 'failed' | 'cancelled',
  errorMessage?: string
): Promise<void> {
  try {
    const { error } = await getDb()
      .from(TABLE)
      .update({
        status,
        error: errorMessage ?? null,
        answered_at: new Date().toISOString(),
      })
      .eq('session_id', sessionId)
      .eq('turn_id', turnId);
    if (error) throw new Error(error.message);
  } catch (error) {
    warn('outcome', error);
  }
}
