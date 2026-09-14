// Reading admin messages for one viewer, shared by /api/admin/messages and
// the /admin/messages/[id] page (which loads the thread in its frontmatter
// so the island paints with it). Server-only; the access rules are in
// ./access and every mutation goes through the API route.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminMessageReplyRow, AdminMessageRow } from '@/lib/db';
import type { SopViewer } from '@/lib/sops/levels';
import type { PeopleNames } from '@/lib/sops/names';
import { getPeopleNames } from '@/lib/sops/people';
import { canViewMessage } from './access';

/** A message as the list shows it: the row plus what its thread is up to. */
export interface MessageSummary extends AdminMessageRow {
  reply_count: number;
  last_activity_at: string;
}

export interface MessageThreadPayload {
  message: AdminMessageRow;
  replies: AdminMessageReplyRow[];
  people: PeopleNames;
}

export type LoadResult =
  | { ok: true; thread: MessageThreadPayload }
  | { ok: false; status: 404 | 500; error: string };

const LIST_LIMIT = 200;

/**
 * The messages `viewer` may read, pinned first then newest first, with each
 * thread's reply count and last activity. Archived messages only for admins.
 */
export async function listMessagesForViewer(
  db: SupabaseClient,
  viewer: SopViewer,
  options: { includeArchived?: boolean } = {}
): Promise<{ messages: MessageSummary[]; people: PeopleNames; error: string | null }> {
  let query = db
    .from('admin_messages')
    .select('*')
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT);
  if (!options.includeArchived) query = query.is('archived_at', null);
  const { data, error } = await query;
  if (error) return { messages: [], people: {}, error: error.message };

  const visible = ((data ?? []) as AdminMessageRow[]).filter((m) => canViewMessage(viewer, m));
  if (visible.length === 0) return { messages: [], people: {}, error: null };

  const { data: replyRows, error: replyError } = await db
    .from('admin_message_replies')
    .select('message_id, author_email, created_at')
    .in(
      'message_id',
      visible.map((m) => m.id)
    );
  if (replyError) return { messages: [], people: {}, error: replyError.message };

  const counts = new Map<string, number>();
  const latest = new Map<string, string>();
  const authors: string[] = [];
  for (const r of (replyRows ?? []) as Pick<
    AdminMessageReplyRow,
    'message_id' | 'author_email' | 'created_at'
  >[]) {
    counts.set(r.message_id, (counts.get(r.message_id) ?? 0) + 1);
    const prev = latest.get(r.message_id);
    if (!prev || r.created_at > prev) latest.set(r.message_id, r.created_at);
    authors.push(r.author_email);
  }

  const messages: MessageSummary[] = visible.map((m) => ({
    ...m,
    reply_count: counts.get(m.id) ?? 0,
    last_activity_at: latest.get(m.id) ?? m.created_at,
  }));
  const people = await getPeopleNames([
    ...visible.flatMap((m) => [m.author_email, m.updated_by ?? '']),
    ...authors,
  ]);
  return { messages, people, error: null };
}

/**
 * One thread for `viewer`. A message they may not see reads as missing,
 * the way the other routes treat invisible rows.
 */
export async function loadMessageForViewer(
  db: SupabaseClient,
  viewer: SopViewer,
  id: string
): Promise<LoadResult> {
  const { data, error } = await db.from('admin_messages').select('*').eq('id', id).maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  const message = (data as AdminMessageRow | null) ?? null;
  if (!message || !canViewMessage(viewer, message)) {
    return { ok: false, status: 404, error: 'Message not found' };
  }

  const { data: replyRows, error: replyError } = await db
    .from('admin_message_replies')
    .select('*')
    .eq('message_id', id)
    .order('created_at', { ascending: true });
  if (replyError) return { ok: false, status: 500, error: replyError.message };
  const replies = (replyRows ?? []) as AdminMessageReplyRow[];

  const people = await getPeopleNames([
    message.author_email,
    message.updated_by ?? '',
    ...replies.flatMap((r) => [r.author_email, r.updated_by ?? '']),
  ]);
  return { ok: true, thread: { message, replies, people } };
}
