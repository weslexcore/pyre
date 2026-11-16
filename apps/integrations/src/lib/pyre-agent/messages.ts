// Pyre Agent's read of the admin messages (/admin/messages), as the person
// in the conversation sees them: the same audience rules as the page
// (lib/messages/access), drafts only for their author and collaborators.
// Used to find a message before suggesting an edit to it, and to answer
// "what did the last team update say". Server-only.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminMessageRow } from '@/lib/db';
import { canViewMessage, isDraft } from '@/lib/messages/access';
import { displayTitle } from '@/lib/messages/validate';
import type { SopViewer } from '@/lib/sops/levels';
import { messageHref } from '@/lib/suggestions/types';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 60;
const PREVIEW = 240;

function preview(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW ? `${flat.slice(0, PREVIEW - 1).trimEnd()}…` : flat;
}

function summary(message: AdminMessageRow) {
  return {
    id: message.id,
    title: displayTitle(message),
    draft: isDraft(message),
    sentAt: message.sent_at,
    pinned: message.pinned,
    archived: message.archived_at !== null,
    author: message.author_email,
    audienceRoles: message.audience_roles,
    audienceEmails: message.audience_emails,
    requiresAck: message.requires_ack,
    updatedAt: message.updated_at,
    url: messageHref(message.id),
  };
}

/** Messages the viewer can open, pinned then newest; words narrow it to ones that mention them all. */
export async function messagesForAgent(
  db: SupabaseClient,
  viewer: SopViewer,
  input: { query?: string; limit?: number; includeArchived?: boolean }
) {
  let query = db
    .from('admin_messages')
    .select('*')
    .order('pinned', { ascending: false })
    .order('sent_at', { ascending: false, nullsFirst: true })
    .limit(200);
  if (!input.includeArchived) query = query.is('archived_at', null);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const words = (input.query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const visible = ((data ?? []) as AdminMessageRow[])
    .filter((m) => canViewMessage(viewer, m))
    .filter((m) => {
      if (words.length === 0) return true;
      const text = `${m.title}\n${m.body_md}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  return {
    count: visible.length,
    messages: visible.slice(0, limit).map((m) => ({
      ...summary(m),
      preview: preview(m.body_md),
    })),
    canWriteMessages: viewer.role === 'admin',
  };
}

/** One message in full, exactly as stored, for quoting or for suggesting new wording. */
export async function messageForAgent(db: SupabaseClient, viewer: SopViewer, id: string) {
  const { data, error } = await db.from('admin_messages').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  const message = (data as AdminMessageRow | null) ?? null;
  if (!message || !canViewMessage(viewer, message)) {
    return { error: 'No message with that id this person can open; use get_messages for the ids' };
  }
  return { ...summary(message), bodyMd: message.body_md };
}
