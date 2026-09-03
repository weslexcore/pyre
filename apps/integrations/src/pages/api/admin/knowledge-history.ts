// A staff member's own conversations with the knowledge assistant, for the
// history sidebar on /admin/ask. Reads the assistant's audit log
// (public.knowledge_queries, written by pyre-agents) filtered to the
// caller's session email — nobody sees anyone else's questions here; the
// admin-only review of everyone's is /api/admin/knowledge-log.
//
//   GET                → { conversations } — the caller's conversations, newest activity first
//   GET ?sessionId=…   → { sessionId, token, turns } — one conversation's questions,
//                        answers and trails in order, plus a signed token that lets the caller
//                        continue it (the ask route decides whether the session is
//                        still there; if not, the next question starts fresh)
//
// The token is minted here because the log proves ownership: a row with
// this session id and the caller's email means they opened it. Same gate as
// the ask route — the Ask page grant on /admin/users.

import type { APIRoute } from 'astro';
import { requirePage } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import { createAskSessionToken } from '@/lib/knowledge/ask-token';
import {
  type ConversationTurn,
  groupConversations,
  type HistoryRow,
} from '@/lib/knowledge/history';
import { trailFromJson } from '@/lib/knowledge/trail';
import { normalizeEmail } from '@/lib/sops/levels';

export const prerender = false;

const PAGE = '/admin/ask';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** Rows scanned for the list — plenty of questions for one person's sidebar. */
const MAX_ROWS = 600;
/** Conversations the sidebar shows. */
const MAX_CONVERSATIONS = 100;
/** Questions in one conversation. */
const MAX_TURNS = 200;

interface TurnRow {
  id: string;
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
    if (error) return json({ error: error.message }, 500);
    return json({
      conversations: groupConversations((data ?? []) as HistoryRow[], MAX_CONVERSATIONS),
    });
  }

  const { data, error } = await db
    .from('knowledge_queries')
    .select('id, question, answer, status, error, trail, asked_at')
    .eq('asked_by', email)
    .eq('session_id', sessionId)
    .order('asked_at', { ascending: true })
    .limit(MAX_TURNS);
  if (error) return json({ error: error.message }, 500);

  const rows = (data ?? []) as TurnRow[];
  if (rows.length === 0) return json({ error: 'Conversation not found' }, 404);

  const turns: ConversationTurn[] = rows.map((row) => ({
    id: row.id,
    question: row.question,
    answer: row.answer,
    status: row.status,
    error: row.error,
    trail: trailFromJson(row.trail),
    askedAt: row.asked_at,
  }));

  return json({ sessionId, token: createAskSessionToken(sessionId, email), turns });
};
