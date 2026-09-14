// Admin messages → inboxes. A new message reaches its whole audience; a
// reply reaches the message's author and everyone who has already spoken
// in the thread (not every admin — the thread is a conversation, not a
// broadcast). Both share the message as their source, so opening the thread
// reads all of them at once. Best-effort like every notifier.

import type { SupabaseClient } from '@supabase/supabase-js';
import { listStaff } from '@/lib/auth/access';
import type { AdminMessageReplyRow, AdminMessageRow } from '@/lib/db';
import { resolveAudience } from '@/lib/messages/access';
import { createNotifications } from './notify';
import { nameFor } from './recipients';
import { excerpt } from './types';

export function messageHref(id: string): string {
  return `/admin/messages/${id}`;
}

export async function notifyMessagePosted(
  db: SupabaseClient,
  message: AdminMessageRow
): Promise<number> {
  const rows = (await listStaff()) ?? [];
  return createNotifications(db, resolveAudience(rows, message), {
    kind: 'admin_message',
    title: message.title,
    body: excerpt(message.body_md),
    href: messageHref(message.id),
    source: { type: 'admin_message', id: message.id },
    actorEmail: message.author_email,
  });
}

export async function notifyMessageReply(
  db: SupabaseClient,
  message: AdminMessageRow,
  reply: AdminMessageReplyRow,
  earlierReplies: Pick<AdminMessageReplyRow, 'author_email'>[]
): Promise<number> {
  const rows = (await listStaff()) ?? [];
  const recipients = new Set<string>([
    message.author_email,
    ...earlierReplies.map((r) => r.author_email),
  ]);
  return createNotifications(db, recipients, {
    kind: 'message_reply',
    title: `${nameFor(rows, reply.author_email)} replied: ${message.title}`,
    body: excerpt(reply.body_md),
    href: messageHref(message.id),
    source: { type: 'admin_message', id: message.id },
    actorEmail: reply.author_email,
  });
}
