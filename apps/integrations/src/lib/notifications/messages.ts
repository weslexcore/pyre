// Admin messages → inboxes. A new message reaches its whole audience, and an
// edit that widens the audience reaches the people it adds; a reply reaches the message's author and everyone who has already spoken
// in the thread (not every admin — the thread is a conversation, not a
// broadcast). Both share the message as their source, so opening the thread
// reads all of them at once. Best-effort like every notifier.
//
// A draft notifies nobody in its audience until it's sent; sharing one with
// another admin tells just them, so they know there's something to work on.
//
// A new message can also be emailed to its audience (on by default in the
// composer): the whole message, with a link back to the thread for
// questions and additions.

import type { SupabaseClient } from '@supabase/supabase-js';
import { listStaff } from '@/lib/auth/access';
import type { AdminMessageReplyRow, AdminMessageRow } from '@/lib/db';
import { normalizeEmail } from '@/lib/email/address';
import { deliveredTo, sendToEach } from '@/lib/email/send-each';
import { addedAudience, resolveAudience } from '@/lib/messages/access';
import { createNotifications } from './notify';
import { nameFor } from './recipients';
import { excerpt } from './types';

export function messageHref(id: string): string {
  return `/admin/messages/${id}`;
}

/**
 * Tell a message's audience it went out. `senderEmail` is whoever pressed
 * send — the author, or a collaborator sending a shared draft (who then
 * isn't pinged, and the author is).
 */
export async function notifyMessagePosted(
  db: SupabaseClient,
  message: AdminMessageRow,
  senderEmail: string = message.author_email
): Promise<number> {
  const rows = (await listStaff()) ?? [];
  return createNotifications(db, resolveAudience(rows, message), {
    kind: 'admin_message',
    title: message.title,
    body: excerpt(message.body_md),
    href: messageHref(message.id),
    source: { type: 'admin_message', id: message.id },
    actorEmail: senderEmail,
    // A sent draft replaces its collaborators' unread "shared a draft" row.
    supersede: true,
  });
}

/** Markdown links to dashboard paths ("[SOP](/admin/sops/x)") made absolute. */
export function absolutizeLinks(bodyMd: string, origin: string): string {
  return bodyMd.replace(/\]\(\//g, `](${origin}/`);
}

/**
 * Email a new message to everyone it reaches but its author and whoever
 * sent it. Returns how many emails went out; failures are logged per
 * recipient and never thrown.
 */
export async function emailMessagePosted(
  message: AdminMessageRow,
  origin: string,
  senderEmail: string = message.author_email
): Promise<number> {
  const rows = (await listStaff()) ?? [];
  const skip = new Set([normalizeEmail(message.author_email), normalizeEmail(senderEmail)]);
  const recipients = resolveAudience(rows, message).filter((email) => !skip.has(email));
  if (recipients.length === 0) return 0;
  const props = {
    authorName: nameFor(rows, message.author_email),
    title: message.title,
    bodyMd: absolutizeLinks(message.body_md, origin),
    messageUrl: `${origin}${messageHref(message.id)}`,
  };
  const results = await sendToEach(
    recipients,
    (to) => ({
      template: 'admin-message' as const,
      props,
      kind: 'transactional' as const,
      sendKey: `admin-message:${message.id}:${to}`,
    }),
    'admin-message'
  );
  return deliveredTo(results).length;
}

/**
 * An edit widened who can see the message: tell the people it now reaches,
 * as if it had just been posted to them. An archived message is hidden from
 * everyone but admins, so widening one notifies nobody.
 */
export async function notifyMessageAudienceWidened(
  db: SupabaseClient,
  message: AdminMessageRow,
  before: Pick<AdminMessageRow, 'audience_roles' | 'audience_emails'>,
  editorEmail: string
): Promise<number> {
  if (message.archived_at) return 0;
  const rows = (await listStaff()) ?? [];
  const added = addedAudience(rows, before, message);
  if (added.length === 0) return 0;
  return createNotifications(db, added, {
    kind: 'admin_message',
    title: message.title,
    body: excerpt(message.body_md),
    href: messageHref(message.id),
    source: { type: 'admin_message', id: message.id },
    // The author wrote it; the editor only widened it — neither is pinged.
    actorEmail: editorEmail,
  });
}

/** A draft was shared with more admins: tell the ones it adds. */
export async function notifyDraftShared(
  db: SupabaseClient,
  message: AdminMessageRow,
  added: string[],
  editorEmail: string
): Promise<number> {
  if (added.length === 0) return 0;
  const rows = (await listStaff()) ?? [];
  return createNotifications(db, added, {
    kind: 'admin_message',
    title: `${nameFor(rows, editorEmail)} shared a draft: ${message.title}`,
    body: excerpt(message.body_md),
    href: messageHref(message.id),
    source: { type: 'admin_message', id: message.id },
    actorEmail: editorEmail,
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
