// Writing to people's inboxes. Server-only (imports getDb through the client
// type); the pure rules live in ./types and ./recipients.
//
// Every writer here is best-effort by design, the same contract as
// logScheduleChange: a notification that fails to save must never fail the
// event it describes (the assignment was made, the SOP was saved), so errors
// are warned and swallowed and callers never await a result they'd act on.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationKind, StaffNotificationRow } from '@/lib/db';

/** Sanity bound far above the roster size. */
const MAX_RECIPIENTS = 500;

export interface NotificationInput {
  kind: NotificationKind;
  title: string;
  body?: string;
  /** Per-recipient link, or one link for everyone; null = no link. */
  href?: string | null | ((recipient: string) => string | null);
  /** What produced it — lets a newer event replace the stale unread row. */
  source: { type: string; id: string };
  /** Who caused it; never a recipient of their own event. */
  actorEmail?: string | null;
  expiresAt?: string | null;
  /**
   * Replace these recipients' unread rows for the same kind + source before
   * inserting, so editing one shift three times leaves one notice, not three.
   */
  supersede?: boolean;
}

function normalizeRecipients(recipients: Iterable<string>, actor: string | null): string[] {
  const out = new Set<string>();
  for (const raw of recipients) {
    const email = (raw ?? '').trim().toLowerCase();
    if (!email || email === actor) continue;
    out.add(email);
    if (out.size >= MAX_RECIPIENTS) break;
  }
  return [...out];
}

/**
 * One row per recipient. Returns how many were written (0 when nothing
 * needed writing, or when storage failed).
 */
export async function createNotifications(
  db: SupabaseClient,
  recipients: Iterable<string>,
  input: NotificationInput
): Promise<number> {
  const actor = (input.actorEmail ?? '').trim().toLowerCase() || null;
  const emails = normalizeRecipients(recipients, actor);
  if (emails.length === 0) return 0;

  try {
    if (input.supersede) {
      const { error } = await db
        .from('staff_notifications')
        .delete()
        .in('recipient_email', emails)
        .eq('kind', input.kind)
        .eq('source_type', input.source.type)
        .eq('source_id', input.source.id)
        .is('read_at', null)
        .is('dismissed_at', null);
      if (error) console.warn('[notifications] supersede failed:', error.message);
    }

    const rows = emails.map((recipient_email) => ({
      recipient_email,
      kind: input.kind,
      title: input.title.slice(0, 200),
      body: (input.body ?? '').slice(0, 1000),
      href: typeof input.href === 'function' ? input.href(recipient_email) : (input.href ?? null),
      source_type: input.source.type,
      source_id: input.source.id,
      actor_email: actor,
      expires_at: input.expiresAt ?? null,
    }));
    const { error } = await db.from('staff_notifications').insert(rows);
    if (error) {
      console.warn('[notifications] insert failed:', error.message);
      return 0;
    }
    return rows.length;
  } catch (error) {
    console.warn('[notifications] write failed:', error);
    return 0;
  }
}

/** How many unread rows `email` has right now; 0 on any failure. */
export async function countUnread(db: SupabaseClient, email: string): Promise<number> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return 0;
  try {
    const { count, error } = await db
      .from('staff_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_email', normalized)
      .is('read_at', null)
      .is('dismissed_at', null)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
    if (error) {
      console.warn('[notifications] unread count failed:', error.message);
      return 0;
    }
    return count ?? 0;
  } catch (error) {
    console.warn('[notifications] unread count failed:', error);
    return 0;
  }
}

/** The live rows in `email`'s inbox, newest first. */
export async function listInbox(
  db: SupabaseClient,
  email: string,
  limit: number
): Promise<{ rows: StaffNotificationRow[]; error: string | null }> {
  const { data, error } = await db
    .from('staff_notifications')
    .select('*')
    .eq('recipient_email', email)
    .is('dismissed_at', null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as StaffNotificationRow[], error: null };
}

/** Mark rows read for `email` — the given ids, or every live row. */
export async function markRead(
  db: SupabaseClient,
  email: string,
  ids: string[] | 'all'
): Promise<string | null> {
  const now = new Date().toISOString();
  let query = db
    .from('staff_notifications')
    .update({ read_at: now })
    .eq('recipient_email', email)
    .is('read_at', null)
    .is('dismissed_at', null);
  if (ids !== 'all') query = query.in('id', ids);
  const { error } = await query;
  return error ? error.message : null;
}

/** Clear rows from `email`'s inbox; dismissing implies reading. */
export async function dismiss(
  db: SupabaseClient,
  email: string,
  ids: string[]
): Promise<string | null> {
  const now = new Date().toISOString();
  const { error: readError } = await db
    .from('staff_notifications')
    .update({ read_at: now })
    .eq('recipient_email', email)
    .in('id', ids)
    .is('read_at', null);
  if (readError) return readError.message;
  const { error } = await db
    .from('staff_notifications')
    .update({ dismissed_at: now })
    .eq('recipient_email', email)
    .in('id', ids)
    .is('dismissed_at', null);
  return error ? error.message : null;
}

/**
 * Opening the thing a notification points at reads it: every unread row of
 * `email`'s about this source. Best-effort.
 */
export async function markSourceRead(
  db: SupabaseClient,
  email: string,
  sourceType: string,
  sourceId: string
): Promise<void> {
  try {
    const { error } = await db
      .from('staff_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_email', email)
      .eq('source_type', sourceType)
      .eq('source_id', sourceId)
      .is('read_at', null);
    if (error) console.warn('[notifications] source read failed:', error.message);
  } catch (error) {
    console.warn('[notifications] source read failed:', error);
  }
}

/** Every row about a source, for when the source itself is deleted. */
export async function deleteBySource(
  db: SupabaseClient,
  sourceType: string,
  sourceId: string
): Promise<void> {
  try {
    const { error } = await db
      .from('staff_notifications')
      .delete()
      .eq('source_type', sourceType)
      .eq('source_id', sourceId);
    if (error) console.warn('[notifications] source delete failed:', error.message);
  } catch (error) {
    console.warn('[notifications] source delete failed:', error);
  }
}

const DISMISSED_TTL_MS = 60 * 24 * 60 * 60 * 1000;
const EXPIRED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Best-effort cleanup of `email`'s dead rows — dismissed two months ago,
 * expired a month ago — so the table stays the size of what people can
 * still see. Runs on every inbox load; errors are logged and swallowed.
 */
export async function sweepInbox(db: SupabaseClient, email: string): Promise<void> {
  try {
    const now = Date.now();
    const dismissedBefore = new Date(now - DISMISSED_TTL_MS).toISOString();
    const expiredBefore = new Date(now - EXPIRED_TTL_MS).toISOString();
    const { error: a } = await db
      .from('staff_notifications')
      .delete()
      .eq('recipient_email', email)
      .lt('dismissed_at', dismissedBefore);
    if (a) console.warn('[notifications] sweep (dismissed) failed:', a.message);
    const { error: b } = await db
      .from('staff_notifications')
      .delete()
      .eq('recipient_email', email)
      .lt('expires_at', expiredBefore);
    if (b) console.warn('[notifications] sweep (expired) failed:', b.message);
  } catch (error) {
    console.warn('[notifications] sweep failed:', error);
  }
}
