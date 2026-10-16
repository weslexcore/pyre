// Who may see and do what on admin messages. A message names its audience
// twice over — a set of roles and a set of individually named staff — and
// access is the union of the two, exactly as SOP grants work
// (lib/sops/levels). Two rules sit above the grant: admins see every
// message, archived or not, and the author always sees their own. Below it:
// replying is open to whoever can see a message that isn't archived, and
// editing or deleting a reply is its author or an admin.
//
// A draft (sent_at null) sits outside all of that: only its author and the
// admins it's shared with (shared_with) can open it — other admins included
// — and those same people edit, send, or delete it. It has no thread until
// it is sent.
//
// Client-bundle-safe (no db/env imports): the islands use it to decide which
// controls to draw, and every route re-checks it server-side.

import type { AdminMessageReplyRow, AdminMessageRow, StaffRow } from '@/lib/db';
import { normalizeEmail } from '@/lib/email/address';
import { canUseDashboard, roleForStaffRow, type SopRole, type SopViewer } from '@/lib/sops/levels';

/** The parts of a message row the access rules read. */
export type MessageAccessFields = Pick<
  AdminMessageRow,
  'author_email' | 'audience_roles' | 'audience_emails' | 'archived_at' | 'sent_at' | 'shared_with'
>;

/** The parts of a reply row the edit rule reads. */
export type ReplyLike = Pick<AdminMessageReplyRow, 'author_email'>;

/** Whether the message is still a draft (saved, not sent). */
export function isDraft(message: Pick<AdminMessageRow, 'sent_at'>): boolean {
  return message.sent_at === null;
}

/**
 * Whether `viewer` may open and work on this draft: its author, or an admin
 * it's shared with. Sharing with someone who has since lost admin leaves
 * them out, since only admins write messages.
 */
export function canEditDraft(
  viewer: SopViewer,
  message: Pick<AdminMessageRow, 'author_email' | 'shared_with'>
): boolean {
  if (viewer.email.length === 0) return false;
  if (message.author_email === viewer.email) return true;
  return viewer.role === 'admin' && message.shared_with.includes(viewer.email);
}

/** Whether `viewer` may read this message. */
export function canViewMessage(viewer: SopViewer, message: MessageAccessFields): boolean {
  if (isDraft(message)) return canEditDraft(viewer, message);
  if (viewer.role === 'admin') return true;
  if (viewer.email.length > 0 && message.author_email === viewer.email) return true;
  if (message.archived_at) return false;
  if (message.audience_roles.includes(viewer.role)) return true;
  return viewer.email.length > 0 && message.audience_emails.includes(viewer.email);
}

/** Whether `viewer` may add to the thread: visible, sent, and not archived. */
export function canReplyToMessage(viewer: SopViewer, message: MessageAccessFields): boolean {
  return canViewMessage(viewer, message) && !isDraft(message) && !message.archived_at;
}

/** Whether `viewer` may edit or delete this reply: its author, or an admin. */
export function canTouchReply(reply: ReplyLike, viewer: SopViewer): boolean {
  if (viewer.role === 'admin') return true;
  return viewer.email.length > 0 && reply.author_email === viewer.email;
}

/** Only admins write, edit, pin, archive, or delete messages. */
export function canManageMessages(viewer: SopViewer): boolean {
  return viewer.role === 'admin';
}

/**
 * Whether `viewer` may edit, send, or delete this message: any admin once
 * it's sent, only the draft's author and collaborators before.
 */
export function canChangeMessage(
  viewer: SopViewer,
  message: Pick<AdminMessageRow, 'author_email' | 'shared_with' | 'sent_at'>
): boolean {
  if (!canManageMessages(viewer)) return false;
  return isDraft(message) ? canEditDraft(viewer, message) : true;
}

/**
 * Who a sharing edit newly brings onto a draft: in `after` but not `before`,
 * and not the person making the edit.
 */
export function addedCollaborators(before: string[], after: string[], editor: string): string[] {
  const had = new Set(before);
  return after.filter((email) => !had.has(email) && email !== editor);
}

/**
 * Whether holders of a role are told about the message (bell and email):
 * the role is ticked. Admins can open every message either way, so leaving
 * the admin role off a note to one person keeps the other admins from being
 * pinged without hiding it from them.
 */
export function roleIsNotified(
  message: Pick<AdminMessageRow, 'audience_roles'>,
  role: SopRole
): boolean {
  return message.audience_roles.includes(role);
}

/**
 * Everyone on the roster this message reaches — the fan-out list for its
 * notifications and emails. Rows that can use the dashboard (canUseDashboard
 * — not just the ones available to schedule) with an email, whose role is
 * notified (roleIsNotified) or who are named personally; the author is
 * included here and dropped by the notifier.
 */
export function resolveAudience(
  rows: Pick<StaffRow, 'email' | 'active' | 'is_admin' | 'is_shift_lead' | 'pages'>[],
  message: Pick<AdminMessageRow, 'audience_roles' | 'audience_emails'>
): string[] {
  const named = new Set(message.audience_emails.map((e) => e.trim().toLowerCase()));
  const out = new Set<string>();
  for (const row of rows) {
    if (!canUseDashboard(row)) continue;
    const email = normalizeEmail(row.email);
    if (!email) continue;
    if (roleIsNotified(message, roleForStaffRow(row)) || named.has(email)) out.add(email);
  }
  return [...out];
}

/**
 * Who an audience edit newly reaches: on the roster under `after` but not
 * under `before`. Widening a message is how someone who never heard of it
 * comes to see it, so these are the people its edit notifies — nobody who
 * already had it gets a second ping.
 */
export function addedAudience(
  rows: Pick<StaffRow, 'email' | 'active' | 'is_admin' | 'is_shift_lead' | 'pages'>[],
  before: Pick<AdminMessageRow, 'audience_roles' | 'audience_emails'>,
  after: Pick<AdminMessageRow, 'audience_roles' | 'audience_emails'>
): string[] {
  const had = new Set(resolveAudience(rows, before));
  return resolveAudience(rows, after).filter((email) => !had.has(email));
}
