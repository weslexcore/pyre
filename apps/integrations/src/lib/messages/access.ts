// Who may see and do what on admin messages. A message names its audience
// twice over — a set of roles and a set of individually named staff — and
// access is the union of the two, exactly as SOP grants work
// (lib/sops/levels). Two rules sit above the grant: admins see every
// message, archived or not, and the author always sees their own. Below it:
// replying is open to whoever can see a message that isn't archived, and
// editing or deleting a reply is its author or an admin.
//
// Client-bundle-safe (no db/env imports): the islands use it to decide which
// controls to draw, and every route re-checks it server-side.

import type { AdminMessageReplyRow, AdminMessageRow, StaffRow } from '@/lib/db';
import { canUseDashboard, roleForStaffRow, type SopViewer } from '@/lib/sops/levels';

/** The parts of a message row the access rules read. */
export type MessageAccessFields = Pick<
  AdminMessageRow,
  'author_email' | 'audience_roles' | 'audience_emails' | 'archived_at'
>;

/** The parts of a reply row the edit rule reads. */
export type ReplyLike = Pick<AdminMessageReplyRow, 'author_email'>;

/** Whether `viewer` may read this message. */
export function canViewMessage(viewer: SopViewer, message: MessageAccessFields): boolean {
  if (viewer.role === 'admin') return true;
  if (viewer.email.length > 0 && message.author_email === viewer.email) return true;
  if (message.archived_at) return false;
  if (message.audience_roles.includes(viewer.role)) return true;
  return viewer.email.length > 0 && message.audience_emails.includes(viewer.email);
}

/** Whether `viewer` may add to the thread: visible and not archived. */
export function canReplyToMessage(viewer: SopViewer, message: MessageAccessFields): boolean {
  return canViewMessage(viewer, message) && !message.archived_at;
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
 * Everyone on the roster this message reaches — the fan-out list for its
 * notifications. Rows that can use the dashboard (canUseDashboard — not just
 * the ones available to schedule) with an email, whose role is granted or
 * who are named personally; the author is included here and dropped by the
 * notifier.
 */
export function resolveAudience(
  rows: Pick<StaffRow, 'email' | 'active' | 'is_admin' | 'is_shift_lead' | 'pages'>[],
  message: Pick<AdminMessageRow, 'audience_roles' | 'audience_emails'>
): string[] {
  const named = new Set(message.audience_emails.map((e) => e.trim().toLowerCase()));
  const out = new Set<string>();
  for (const row of rows) {
    if (!canUseDashboard(row)) continue;
    const email = (row.email ?? '').trim().toLowerCase();
    if (!email) continue;
    if (message.audience_roles.includes(roleForStaffRow(row)) || named.has(email)) out.add(email);
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
