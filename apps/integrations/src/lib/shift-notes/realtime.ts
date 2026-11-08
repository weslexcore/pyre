// The Realtime topics for shift notes (see the live_notes_boards_checkins
// migration). Shared notes, their replies and attachments broadcast on one
// channel for the page's holders. Admin-only notes go to the admins'
// channel and to the author's own, so nobody hears about a note they could
// not read; a private reply goes to admins only. The log island listens on
// the shared channel plus whichever of the other two is its viewer's, and
// refetches. Client-bundle-safe.

import { normalizeEmail } from '@/lib/email/address';

export const SHIFT_NOTES_TOPIC = 'shift-notes';
export const SHIFT_NOTES_ADMIN_TOPIC = 'shift-notes:admin';

export function shiftNotesAuthorTopic(email: string): string {
  return `shift-notes:author:${normalizeEmail(email)}`;
}

/** The second channel a viewer listens on: the admins' or their own author channel. */
export function shiftNotesViewerTopic(viewer: { email: string; isAdmin: boolean }): string | null {
  if (viewer.isAdmin) return SHIFT_NOTES_ADMIN_TOPIC;
  return viewer.email ? shiftNotesAuthorTopic(viewer.email) : null;
}
