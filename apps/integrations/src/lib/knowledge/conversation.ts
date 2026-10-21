// A Pyre Agent conversation across sessions. A conversation is its first
// session; when that session ends and the person writes again, the
// dashboard continues it in a new session linked to the first
// (public.pyre_agent_session_links). Everything that reads "a conversation"
// — the history sidebar, a reopened conversation, its proposals, its
// routine — goes through here to see every session in it. Every read is
// scoped to the owner's email. Server-only.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CarriedTurn } from './carry';

interface LinkRow {
  session_id: string;
  conversation_id: string;
  created_at: string;
}

/** The conversation a session belongs to: its first session's id. */
export async function conversationOf(
  db: SupabaseClient,
  email: string,
  sessionId: string
): Promise<string> {
  const { data } = await db
    .from('pyre_agent_session_links')
    .select('conversation_id')
    .eq('session_id', sessionId)
    .eq('owner_email', email)
    .maybeSingle();
  return (data as { conversation_id: string } | null)?.conversation_id ?? sessionId;
}

/** Every session in a conversation, oldest first; the last is the live one. */
export async function sessionsOf(
  db: SupabaseClient,
  email: string,
  conversationId: string
): Promise<string[]> {
  const { data } = await db
    .from('pyre_agent_session_links')
    .select('session_id, conversation_id, created_at')
    .eq('conversation_id', conversationId)
    .eq('owner_email', email)
    .order('created_at', { ascending: true });
  return [conversationId, ...((data ?? []) as LinkRow[]).map((row) => row.session_id)];
}

/** Session id → conversation id, for every continuing session among `sessionIds`. */
export async function conversationMap(
  db: SupabaseClient,
  email: string,
  sessionIds: string[]
): Promise<Map<string, string>> {
  if (sessionIds.length === 0) return new Map();
  const { data } = await db
    .from('pyre_agent_session_links')
    .select('session_id, conversation_id, created_at')
    .eq('owner_email', email)
    .in('session_id', sessionIds);
  return new Map(((data ?? []) as LinkRow[]).map((row) => [row.session_id, row.conversation_id]));
}

/** Most questions read back to carry; the block keeps only what fits anyway. */
const CARRY_READ_LIMIT = 200;

/** The conversation's questions and answers so far, oldest first, across its sessions. */
export async function conversationTurns(
  db: SupabaseClient,
  email: string,
  conversationId: string
): Promise<CarriedTurn[]> {
  const sessions = await sessionsOf(db, email, conversationId);
  const { data, error } = await db
    .from('knowledge_queries')
    .select('question, answer, asked_at')
    .eq('asked_by', email)
    .in('session_id', sessions)
    .order('asked_at', { ascending: true })
    .limit(CARRY_READ_LIMIT);
  if (error) throw new Error(error.message);
  return ((data ?? []) as { question: string | null; answer: string | null }[]).map((row) => ({
    question: row.question ?? '',
    answer: row.answer,
  }));
}

/** Record that `sessionId` continues `conversationId`. Best-effort: the answer still goes ahead. */
export async function linkSession(
  db: SupabaseClient,
  link: { sessionId: string; conversationId: string; email: string; carriedTurns: number }
): Promise<void> {
  const { error } = await db.from('pyre_agent_session_links').insert({
    session_id: link.sessionId,
    conversation_id: link.conversationId,
    owner_email: link.email,
    carried_turns: link.carriedTurns,
  });
  if (error) console.warn('[pyre-agent] could not link the continuing session:', error.message);
}
