// A staff member's own conversations with the knowledge assistant, for the
// history sidebar on /admin/ask. Reads the assistant's audit log
// (public.knowledge_queries, written by pyre-agents) filtered to the
// caller's session email — nobody sees anyone else's questions here; the
// admin-only review of everyone's is /api/admin/knowledge-log.
//
//   GET                → { conversations } — the caller's conversations, newest activity first
//   GET ?sessionId=…   → { sessionId, conversationId, token, turns, routine } — one
//                        conversation's questions,
//                        answers and trails in order, plus a signed token that lets the caller
//                        continue it (the ask route decides whether the session is
//                        still there; if not, the next question starts fresh)
//
// A conversation a saved routine opened (lib/pyre-agent/routines) carries
// `routine` — which routine, when and how it ran, its schedule — in both
// reads, so the page can mark it as the routine's rather than a question
// someone typed. A routine run's conversation is readable as soon as the
// run starts, before its first turn is logged (turns: []), so Run now can
// open it and stream the answer in.
//
// A conversation can span sessions: when its agent session ended and the
// person wrote again, it carried on in a new session linked to the first
// (lib/knowledge/conversation). The list shows it once, under its first
// session's id; reading it returns every session's turns in order, marks
// where a new session picked up, and hands back the live (newest) session
// with its token, so the next question goes there.
//
// The token is minted here because the log proves ownership: a row with
// this session id and the caller's email means they opened it. Same gate as
// the ask route — the Ask page grant on /admin/users.

import type { APIRoute } from 'astro';
import { requirePage } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import { normalizeEmail } from '@/lib/email/address';
import { dbError, json } from '@/lib/http/route';
import { createAskSessionToken } from '@/lib/knowledge/ask-token';
import { conversationMap, conversationOf, sessionsOf } from '@/lib/knowledge/conversation';
import {
  type ConversationTurn,
  groupConversations,
  type HistoryRow,
  type RoutineRunOrigin,
} from '@/lib/knowledge/history';
import { trailFromJson } from '@/lib/knowledge/trail';
import { describeCadence } from '@/lib/pyre-agent/cadence';
import { cadenceOf, type RoutineRow, type RoutineRunRow } from '@/lib/pyre-agent/routines';

export const prerender = false;

const PAGE = '/admin/ask';

/** Rows scanned for the list — plenty of questions for one person's sidebar. */
const MAX_ROWS = 600;
/** Conversations the sidebar shows. */
const MAX_CONVERSATIONS = 100;
/** Questions in one conversation. */
const MAX_TURNS = 200;

interface TurnRow {
  id: string;
  session_id: string;
  question: string;
  answer: string | null;
  status: ConversationTurn['status'];
  error: string | null;
  trail: unknown;
  asked_at: string;
}

export const GET: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const email = normalizeEmail(gate.user.email);
  if (!email) return json({ error: 'No session email' }, 403);

  const sessionId = (new URL(request.url).searchParams.get('sessionId') ?? '').trim();

  if (!sessionId) {
    const { data, error } = await db
      .from('knowledge_queries')
      .select('session_id, question, asked_at')
      .eq('asked_by', email)
      .order('asked_at', { ascending: false })
      .limit(MAX_ROWS);
    if (error) return dbError(error);
    // Continuing sessions fold into the conversation they continue.
    const rows = (data ?? []) as HistoryRow[];
    const folded = await conversationMap(db, email, [...new Set(rows.map((r) => r.session_id))]);
    const conversations = groupConversations(
      rows.map((row) => ({ ...row, session_id: folded.get(row.session_id) ?? row.session_id })),
      MAX_CONVERSATIONS
    );
    if (conversations.length > 0) {
      const { data: runs } = await db
        .from('pyre_agent_routine_runs')
        .select('session_id, routine_id, routine_title')
        .eq('owner_email', email)
        .in(
          'session_id',
          conversations.map((c) => c.sessionId)
        );
      const bySession = new Map(
        ((runs ?? []) as Pick<RoutineRunRow, 'session_id' | 'routine_id' | 'routine_title'>[]).map(
          (run) => [run.session_id, run]
        )
      );
      for (const conversation of conversations) {
        const run = bySession.get(conversation.sessionId);
        if (run) conversation.routine = { routineId: run.routine_id, title: run.routine_title };
      }
    }
    return json({ conversations });
  }

  // Any session of a conversation opens the whole conversation.
  const conversationId = await conversationOf(db, email, sessionId);
  const sessions = await sessionsOf(db, email, conversationId);
  const live = sessions[sessions.length - 1];
  const routine = await routineOrigin(db, email, conversationId);

  const { data, error } = await db
    .from('knowledge_queries')
    .select('id, session_id, question, answer, status, error, trail, asked_at')
    .eq('asked_by', email)
    .in('session_id', sessions)
    .order('asked_at', { ascending: true })
    .limit(MAX_TURNS);
  if (error) return dbError(error);

  const rows = (data ?? []) as TurnRow[];
  if (rows.length === 0 && !routine && sessions.length === 1) {
    return json({ error: 'Conversation not found' }, 404);
  }

  const turns: ConversationTurn[] = rows.map((row, index) => ({
    id: row.id,
    question: row.question,
    answer: row.answer,
    status: row.status,
    error: row.error,
    trail: trailFromJson(row.trail),
    askedAt: row.asked_at,
    // The first question a new session took, after the one before it ended.
    ...(index > 0 && row.session_id !== rows[index - 1].session_id
      ? { continuesConversation: true }
      : {}),
  }));

  return json({
    sessionId: live,
    conversationId,
    token: createAskSessionToken(live, email),
    turns,
    routine,
  });
};

/** The routine run that opened this conversation, when it is one of the caller's. */
async function routineOrigin(
  db: NonNullable<ReturnType<typeof getDb>>,
  email: string,
  sessionId: string
): Promise<RoutineRunOrigin | null> {
  const { data } = await db
    .from('pyre_agent_routine_runs')
    .select('*')
    .eq('session_id', sessionId)
    .eq('owner_email', email)
    .limit(1)
    .maybeSingle();
  const run = data as RoutineRunRow | null;
  if (!run) return null;
  const { data: routineData } = run.routine_id
    ? await db.from('pyre_agent_routines').select('*').eq('id', run.routine_id).maybeSingle()
    : { data: null };
  const routine = routineData as RoutineRow | null;
  return {
    routineId: routine?.id ?? null,
    title: routine?.title ?? run.routine_title,
    trigger: run.trigger,
    ranAt: run.started_at,
    schedule: routine ? describeCadence(cadenceOf(routine)) : null,
    enabled: routine?.enabled ?? false,
    prompt: routine?.prompt ?? null,
  };
}
