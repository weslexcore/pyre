// Admin messages → inboxes. A new message reaches its whole audience, and an
// edit that widens the audience reaches the people it adds; a reply reaches
// the message's author and everyone who has already spoken in the thread
// (not every admin — the thread is a conversation, not a broadcast). Both
// share the message as their source, so opening the thread reads all of
// them at once. Best-effort like every notifier.
//
// Anyone a message or a reply @-mentions — and who can open the message
// (lib/messages/access messageMentionPeople) — hears about the mention
// instead of the ordinary notice (lib/notifications/mentions), so being
// named reads as one bell row. An edit that adds a mention tells the people
// it adds.
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
import { mentionsAsNames, namesOf } from '@/lib/mentions';
import { addedAudience, messageMentionPeople, resolveAudience } from '@/lib/messages/access';
import { displayTitle } from '@/lib/messages/validate';
import { notifyMentions, withoutMentioned } from './mentions';
import { createNotifications } from './notify';
import { nameFor } from './recipients';
import { quotedTitle } from './text';
import { excerpt } from './types';

export function messageHref(id: string): string {
  return `/admin/messages/${id}`;
}

/** What a mention notice says it was in: 'the message "Towel count"'. */
function messagePhrase(message: Pick<AdminMessageRow, 'title'>): string {
  return `the message ${quotedTitle(displayTitle(message))}`;
}

function replyPhrase(message: Pick<AdminMessageRow, 'title'>): string {
  return `a reply on ${quotedTitle(displayTitle(message))}`;
}

/**
 * Tell a message's audience it went out. `senderEmail` is whoever pressed
 * send — the author, or a collaborator sending a shared draft (who then
 * isn't pinged, and the author is). Anyone the body @-mentions hears about
 * the mention, from its author, instead.
 */
export async function notifyMessagePosted(
  db: SupabaseClient,
  message: AdminMessageRow,
  senderEmail: string = message.author_email
): Promise<number> {
  const rows = (await listStaff()) ?? [];
  const people = messageMentionPeople(rows, message);
  const mentioned = await notifyMentions(db, {
    text: message.body_md,
    people,
    actorEmail: message.author_email,
    where: messagePhrase(message),
    href: messageHref(message.id),
    source: { type: 'admin_message', id: message.id },
    expiresAt: null,
  });
  const told = await createNotifications(
    db,
    withoutMentioned(resolveAudience(rows, message), mentioned),
    {
      kind: 'admin_message',
      title: message.title,
      body: excerpt(mentionsAsNames(message.body_md, namesOf(people))),
      href: messageHref(message.id),
      source: { type: 'admin_message', id: message.id },
      actorEmail: senderEmail,
      // A sent draft replaces its collaborators' unread "shared a draft" row.
      supersede: true,
    }
  );
  return told + mentioned.length;
}

/**
 * A sent message's text was edited: tell the people the new text @-mentions
 * that the old one didn't. Everyone else already has the message.
 */
export async function notifyMessageEdited(
  db: SupabaseClient,
  message: AdminMessageRow,
  previousBody: string,
  editorEmail: string
): Promise<number> {
  const rows = (await listStaff()) ?? [];
  const mentioned = await notifyMentions(db, {
    text: message.body_md,
    previousText: previousBody,
    people: messageMentionPeople(rows, message),
    actorEmail: editorEmail,
    where: messagePhrase(message),
    href: messageHref(message.id),
    source: { type: 'admin_message', id: message.id },
    expiresAt: null,
  });
  return mentioned.length;
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
    // Mentions read as names in the mail, where nothing draws them as chips.
    bodyMd: mentionsAsNames(
      absolutizeLinks(message.body_md, origin),
      namesOf(messageMentionPeople(rows, message))
    ),
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
    body: excerpt(mentionsAsNames(message.body_md, namesOf(messageMentionPeople(rows, message)))),
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
    title: `${nameFor(rows, editorEmail)} shared a draft: ${displayTitle(message)}`,
    body: excerpt(message.body_md),
    href: messageHref(message.id),
    source: { type: 'admin_message', id: message.id },
    actorEmail: editorEmail,
  });
}

/**
 * A reply joined the thread: whoever it @-mentions hears about the mention;
 * the author and the earlier repliers hear about the reply.
 */
export async function notifyMessageReply(
  db: SupabaseClient,
  message: AdminMessageRow,
  reply: AdminMessageReplyRow,
  earlierReplies: Pick<AdminMessageReplyRow, 'author_email'>[]
): Promise<number> {
  const rows = (await listStaff()) ?? [];
  const people = messageMentionPeople(rows, message);
  const mentioned = await notifyMentions(db, {
    text: reply.body_md,
    people,
    actorEmail: reply.author_email,
    where: replyPhrase(message),
    href: messageHref(message.id),
    source: { type: 'admin_message', id: message.id },
    expiresAt: null,
  });
  const recipients = withoutMentioned(
    new Set<string>([message.author_email, ...earlierReplies.map((r) => r.author_email)]),
    mentioned
  );
  const told = await createNotifications(db, recipients, {
    kind: 'message_reply',
    title: `${nameFor(rows, reply.author_email)} replied: ${message.title}`,
    body: excerpt(mentionsAsNames(reply.body_md, namesOf(people))),
    href: messageHref(message.id),
    source: { type: 'admin_message', id: message.id },
    actorEmail: reply.author_email,
  });
  return told + mentioned.length;
}

/** A reply was edited: tell the people its new text @-mentions that the old one didn't. */
export async function notifyMessageReplyEdited(
  db: SupabaseClient,
  message: AdminMessageRow,
  reply: AdminMessageReplyRow,
  previousBody: string,
  editorEmail: string
): Promise<number> {
  const rows = (await listStaff()) ?? [];
  const mentioned = await notifyMentions(db, {
    text: reply.body_md,
    previousText: previousBody,
    people: messageMentionPeople(rows, message),
    actorEmail: editorEmail,
    where: replyPhrase(message),
    href: messageHref(message.id),
    source: { type: 'admin_message', id: message.id },
    expiresAt: null,
  });
  return mentioned.length;
}
