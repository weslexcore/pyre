// Reading admin messages for one viewer, shared by /api/admin/messages and
// the /admin/messages/[id] page (which loads the thread in its frontmatter
// so the island paints with it). Server-only; the access rules are in
// ./access and every mutation goes through the API route.

import type { SupabaseClient } from '@supabase/supabase-js';
import { listStaff } from '@/lib/auth/access';
import type { AdminMessageAckRow, AdminMessageReplyRow, AdminMessageRow } from '@/lib/db';
import { type MentionPerson, mentionedAddresses } from '@/lib/mentions';
import type { SopViewer } from '@/lib/sops/levels';
import type { PeopleNames } from '@/lib/sops/names';
import { getPeopleNames } from '@/lib/sops/people';
import { ackRoster, ackStatus, canViewMessage, messageMentionPeople } from './access';

/** A message as the list shows it: the row plus what its thread is up to. */
export interface MessageSummary extends AdminMessageRow {
  reply_count: number;
  last_activity_at: string;
  /** When the viewer acknowledged it (requires_ack messages); null if they haven't. */
  acked_at: string | null;
  /** Admins only, on requires_ack messages: how many of the roster have acknowledged. */
  ack_done?: number;
  /** Admins only, on requires_ack messages: how many the message asks to acknowledge. */
  ack_total?: number;
}

/**
 * Where a message's acknowledgments stand. Everyone learns their own; only
 * admins see who else has (and hasn't) — it's an accountability record.
 */
export interface AckSummary {
  /** When the viewer acknowledged it; null if they haven't. */
  mine: string | null;
  /** Admins only: everyone who has acknowledged, earliest first. */
  done?: { email: string; at: string }[];
  /** Admins only: who the message asks (ackRoster) that hasn't yet. */
  pending?: string[];
  /** Admins only: how many the message asks (the roster's size). */
  total?: number;
}

export interface MessageThreadPayload {
  message: AdminMessageRow;
  replies: AdminMessageReplyRow[];
  people: PeopleNames;
  /** Who the message was emailed to (empty when it wasn't emailed). */
  emailedTo: string[];
  /** Who a reply may @-mention: everyone who can open the message (lib/messages/access). */
  mentionPeople: MentionPerson[];
  /** Acknowledgments, when the message asks for them (null otherwise). */
  ack: AckSummary | null;
}

export type LoadResult =
  | { ok: true; thread: MessageThreadPayload }
  | { ok: false; status: 404 | 500; error: string };

const LIST_LIMIT = 200;

/**
 * The messages `viewer` may read, pinned first then newest sent first, with
 * each thread's reply count and last activity. Archived messages only for
 * admins. Drafts the viewer may work on are included (sent_at null); the
 * page shows them apart.
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
    .order('sent_at', { ascending: false, nullsFirst: true })
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

  const asking = visible.filter((m) => m.requires_ack);
  const acks = await loadAcks(
    db,
    asking.map((m) => m.id)
  );
  const isAdmin = viewer.role === 'admin';
  const staffRows = isAdmin && asking.length > 0 ? ((await listStaff()) ?? []) : [];

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

  const messages: MessageSummary[] = visible.map((m) => {
    const summary: MessageSummary = {
      ...m,
      reply_count: counts.get(m.id) ?? 0,
      last_activity_at: latest.get(m.id) ?? m.sent_at ?? m.updated_at,
      acked_at: null,
    };
    if (!m.requires_ack) return summary;
    const rows = acks.filter((a) => a.message_id === m.id);
    summary.acked_at = rows.find((a) => a.email === viewer.email)?.acknowledged_at ?? null;
    if (isAdmin) {
      const roster = ackRoster(staffRows, m);
      summary.ack_done = ackStatus(
        roster,
        rows.map((a) => a.email)
      ).done.length;
      summary.ack_total = roster.length;
    }
    return summary;
  });
  const people = await getPeopleNames([
    ...visible.flatMap((m) => [m.author_email, m.updated_by ?? '', ...m.shared_with]),
    ...authors,
  ]);
  return { messages, people, error: null };
}

/** The acknowledgments of these messages, earliest first. Best-effort — [] on failure. */
async function loadAcks(db: SupabaseClient, ids: string[]): Promise<AdminMessageAckRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await db
    .from('admin_message_acks')
    .select('*')
    .in('message_id', ids)
    .order('acknowledged_at', { ascending: true });
  if (error) {
    console.warn('[messages] acks read failed:', error.message);
    return [];
  }
  return (data ?? []) as AdminMessageAckRow[];
}

/**
 * Where one message's acknowledgments stand for `viewer` (AckSummary), or
 * null when it doesn't ask for them.
 */
export async function ackSummaryFor(
  db: SupabaseClient,
  viewer: SopViewer,
  message: AdminMessageRow,
  staffRows?: Awaited<ReturnType<typeof listStaff>>
): Promise<AckSummary | null> {
  if (!message.requires_ack) return null;
  const acks = await loadAcks(db, [message.id]);
  const mine = acks.find((a) => a.email === viewer.email)?.acknowledged_at ?? null;
  if (viewer.role !== 'admin') return { mine };
  const roster = ackRoster(staffRows ?? (await listStaff()) ?? [], message);
  return {
    mine,
    done: acks.map((a) => ({ email: a.email, at: a.acknowledged_at })),
    pending: ackStatus(
      roster,
      acks.map((a) => a.email)
    ).pending,
    total: roster.length,
  };
}

/**
 * The people a message was emailed to, read from the send log: each delivered
 * email holds the key `admin-message:<id>:<recipient>`, and a send that was
 * gated or failed leaves no row behind. Best-effort — [] on any failure.
 */
async function loadEmailedTo(db: SupabaseClient, id: string): Promise<string[]> {
  const { data, error } = await db
    .from('email_sends')
    .select('email')
    .like('send_key', `admin-message:${id}:%`)
    .eq('status', 'sent')
    .order('sent_at', { ascending: true });
  if (error) {
    console.warn('[messages] emailed-to read failed:', error.message);
    return [];
  }
  return [...new Set((data ?? []).map((row: { email: string }) => row.email))];
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

  const emailedTo = await loadEmailedTo(db, id);
  const staffRows = (await listStaff()) ?? [];
  const ack = await ackSummaryFor(db, viewer, message, staffRows);
  const people = await getPeopleNames([
    ...(ack?.done ?? []).map((a) => a.email),
    ...(ack?.pending ?? []),
    message.author_email,
    message.updated_by ?? '',
    ...message.shared_with,
    ...replies.flatMap((r) => [r.author_email, r.updated_by ?? '']),
    ...emailedTo,
    // Whoever the message and its replies @-mention, so each reads as a name.
    ...mentionedAddresses(message.body_md),
    ...replies.flatMap((r) => mentionedAddresses(r.body_md)),
  ]);
  const mentionPeople = messageMentionPeople(staffRows, message).map(({ email, name }) => ({
    email,
    name,
  }));
  return { ok: true, thread: { message, replies, people, emailedTo, mentionPeople, ack } };
}
