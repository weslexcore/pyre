// The knowledge assistant's audit log (public.knowledge_queries): one row per
// question, keyed by (session, turn), carrying who asked, the access they
// had, the tools the assistant called, its trail (narration and each tool
// call with input and result, in order — what the Ask page shows beside
// the answer, and what a reopened conversation gets back), and the answer.
// Admins review it on /admin/ask/log.
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

/**
 * One step of the turn's trail. Mirrors TrailStep in the integrations app
 * (src/lib/knowledge/trail.ts), which reads the column back.
 */
export type TrailStep =
  | { kind: 'thought'; text: string }
  | {
      kind: 'tool';
      callId: string;
      tool: string;
      input: Record<string, unknown>;
      status: 'running' | 'completed' | 'failed';
      output?: string;
      error?: string;
    };

/** Trail steps kept per turn; a knowledge turn is a handful of lookups, not fifty. */
const TRAIL_MAX_STEPS = 60;
/** Tool outputs longer than this are cut in the trail (the model still saw everything). */
export const TRAIL_OUTPUT_MAX_LENGTH = 6000;
/** Narration longer than this is cut. */
const TRAIL_THOUGHT_MAX_LENGTH = 4000;

/** A tool's output as one capped string for the trail. */
export function serializeToolOutput(output: unknown): string {
  let text: string;
  if (typeof output === 'string') text = output;
  else if (output === undefined) text = '';
  else {
    try {
      text = JSON.stringify(output, null, 2) ?? '';
    } catch {
      text = String(output);
    }
  }
  return text.length > TRAIL_OUTPUT_MAX_LENGTH
    ? `${text.slice(0, TRAIL_OUTPUT_MAX_LENGTH)}\n… (cut, ${text.length - TRAIL_OUTPUT_MAX_LENGTH} more characters)`
    : text;
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

/**
 * Read-modify-write the turn's trail. The two channel handlers that touch it
 * (actions.requested, action.result) run for different events in stream
 * order, so the window for a lost update is small; a lost step shows up as
 * a gap in the trail, never as a failed turn.
 */
async function updateTrail(
  sessionId: string,
  turnId: string,
  step: string,
  change: (trail: TrailStep[]) => TrailStep[] | null
): Promise<void> {
  try {
    const db = getDb();
    const { data, error } = await db
      .from(TABLE)
      .select('id, trail')
      .eq('session_id', sessionId)
      .eq('turn_id', turnId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return;
    const existing = Array.isArray(data.trail) ? (data.trail as TrailStep[]) : [];
    const next = change(existing);
    if (!next) return;
    const { error: updateError } = await db
      .from(TABLE)
      .update({ trail: next.slice(0, TRAIL_MAX_STEPS) })
      .eq('id', data.id);
    if (updateError) throw new Error(updateError.message);
  } catch (error) {
    warn(step, error);
  }
}

/** Narration the assistant wrote before calling a tool, or a reasoning block. */
export async function auditThought(sessionId: string, turnId: string, text: string): Promise<void> {
  const trimmed = text.trim().slice(0, TRAIL_THOUGHT_MAX_LENGTH);
  if (!trimmed) return;
  await updateTrail(sessionId, turnId, 'trail thought', (trail) => [
    ...trail,
    { kind: 'thought', text: trimmed },
  ]);
}

/** Tool calls the assistant requested, appended to the trail as running. */
export async function auditTrailCalls(
  sessionId: string,
  turnId: string,
  calls: Array<{ callId: string; tool: string; input: Record<string, unknown> }>
): Promise<void> {
  if (calls.length === 0) return;
  await updateTrail(sessionId, turnId, 'trail calls', (trail) => {
    const known = new Set(trail.map((s) => (s.kind === 'tool' ? s.callId : '')));
    const added = calls
      .filter((c) => !known.has(c.callId))
      .map<TrailStep>((c) => ({ kind: 'tool', ...c, status: 'running' }));
    return added.length > 0 ? [...trail, ...added] : null;
  });
}

/**
 * A tool call's result, recorded on its trail step. The step is normally
 * there already (its request event came first); one short retry covers the
 * handlers landing in the other order.
 */
export async function auditTrailResult(
  sessionId: string,
  turnId: string,
  result: { callId: string; status: 'completed' | 'failed'; output: unknown; error?: string }
): Promise<void> {
  const output = serializeToolOutput(result.output);
  for (let attempt = 0; attempt < 2; attempt++) {
    let found = false;
    await updateTrail(sessionId, turnId, 'trail result', (trail) => {
      found = trail.some((s) => s.kind === 'tool' && s.callId === result.callId);
      if (!found) return null;
      return trail.map((s) =>
        s.kind === 'tool' && s.callId === result.callId
          ? {
              ...s,
              status: result.status,
              output,
              ...(result.error ? { error: result.error } : {}),
            }
          : s
      );
    });
    if (found) return;
    await new Promise((resolve) => setTimeout(resolve, 750));
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
