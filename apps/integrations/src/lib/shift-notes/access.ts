// Who may see which shift notes. Everyone on the roster writes them, but the
// log is not a shared feed: an admin reads every note, and everyone else reads
// only the ones they wrote themselves. Reading and editing land on the same
// rule — if you can see a note you may edit or delete it, and there is nothing
// you can edit that you cannot see — so both the notes route and the media
// route gate on this one predicate.
//
// Client-bundle-safe (no db/env imports): the island uses it to decide which
// controls to draw, and every route re-checks it server-side.

export interface NoteViewer {
  /** Session email, already lowercased; '' when the session carries none. */
  email: string;
  isAdmin: boolean;
}

/** The author attribution of a note — the part of the row this rule reads. */
export interface AuthoredNote {
  author_email: string;
}

/** Normalize a session email the way author_email is stored. */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/**
 * Whether `viewer` may read this note (and, identically, edit or delete it):
 * admins on the whole log, everyone else on their own notes only.
 */
export function canSeeNote(note: AuthoredNote, viewer: NoteViewer): boolean {
  if (viewer.isAdmin) return true;
  return !!viewer.email && note.author_email === viewer.email;
}
