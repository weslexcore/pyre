// Who may see and do what on shift notes. Everyone on the roster writes them,
// and by default everyone who holds the page reads them: the log is a shared
// feed. A note marked admin-only (the writer's checkbox, or flipped later by
// the author or an admin) stays with its author and the admins. Seeing and
// changing are separate rules: anyone who can see a note can read it and its
// media, but editing, deleting, and switching who can see it stay with the
// author and the admins. The notes route and the media route gate reads on
// canSeeNote, and every change on canEditNote.
//
// On top of a note sit two things only the thread needs rules for:
//
//   * status — open / todo / resolved, set by admins only (the classifier
//     also triages notes no admin has yet, server-side: ./triage); the
//     author sees it.
//   * activity — the note's thread. The author and the admins may comment
//     (it is their conversation, shared note or not); an entry is visible to
//     whoever sees the note, unless it is private, in which case only admins
//     read it. Editing or deleting a comment is its author or an admin. The
//     other entries are events the app recorded (status changes, edits,
//     classifications) and nobody edits or deletes them.
//
// Client-bundle-safe (no db/env imports): the island uses it to decide which
// controls to draw, and every route re-checks it server-side.

import type { ShiftNoteActivityKind, ShiftNoteStatus } from '@/lib/db';

export interface NoteViewer {
  /** Session email, already lowercased; '' when the session carries none. */
  email: string;
  isAdmin: boolean;
}

/** The author attribution of a note — the part of the row the edit rule reads. */
export interface AuthoredNote {
  author_email: string;
}

/** The parts of a note the visibility rule reads. */
export interface VisibleNote extends AuthoredNote {
  /** Only admins (and the author) see it. */
  admin_only: boolean;
}

/** The parts of a reply row the visibility and edit rules read. */
export interface ReplyLike {
  author_email: string | null;
  is_private: boolean;
  /** Absent reads as a comment. */
  kind?: ShiftNoteActivityKind;
}

/** Whether this is the viewer's own note. A session without an email owns nothing. */
function isAuthor(note: AuthoredNote, viewer: NoteViewer): boolean {
  return !!viewer.email && note.author_email === viewer.email;
}

/**
 * Whether `viewer` may read this note and its media: a shared note is
 * everyone's (who holds the page — the route checks that), an admin-only one
 * is the admins' and its author's.
 */
export function canSeeNote(note: VisibleNote, viewer: NoteViewer): boolean {
  return !note.admin_only || viewer.isAdmin || isAuthor(note, viewer);
}

/**
 * Whether `viewer` may edit or delete this note, or change who can see it:
 * its author and the admins. Everything you can edit you can also see.
 */
export function canEditNote(note: AuthoredNote, viewer: NoteViewer): boolean {
  return viewer.isAdmin || isAuthor(note, viewer);
}

/** The label for a note's visibility, as the log shows it. */
export function visibilityLabel(note: Pick<VisibleNote, 'admin_only'>): string {
  return note.admin_only ? 'Admins only' : 'Everyone';
}

/** Matches the shift_notes status check constraint. */
export const SHIFT_NOTE_STATUSES: readonly ShiftNoteStatus[] = ['open', 'todo', 'resolved'];

export function isShiftNoteStatus(value: unknown): value is ShiftNoteStatus {
  return typeof value === 'string' && (SHIFT_NOTE_STATUSES as string[]).includes(value);
}

const STATUS_LABELS: Record<ShiftNoteStatus, string> = {
  open: 'Open',
  todo: 'To do',
  resolved: 'Resolved',
};

export function statusLabel(status: ShiftNoteStatus): string {
  return STATUS_LABELS[status];
}

/** Only admins triage a note. */
export function canSetStatus(viewer: NoteViewer): boolean {
  return viewer.isAdmin;
}

/**
 * Replying is the author's conversation with the admins, so it follows the
 * edit rule — on a shared note, everyone else reads the thread but does not
 * write in it.
 */
export function canReply(note: AuthoredNote, viewer: NoteViewer): boolean {
  return canEditNote(note, viewer);
}

/**
 * Whether `viewer` may read this reply. The caller has already checked the
 * note; this only hides admin-private replies from everyone else.
 */
export function canSeeReply(reply: ReplyLike, viewer: NoteViewer): boolean {
  return viewer.isAdmin || !reply.is_private;
}

/** Editing or deleting a comment: its author, or an admin. Events are history and stay put. */
export function canTouchReply(reply: ReplyLike, viewer: NoteViewer): boolean {
  if (reply.kind !== undefined && reply.kind !== 'comment') return false;
  if (viewer.isAdmin) return true;
  return !!viewer.email && reply.author_email === viewer.email;
}

/**
 * The PostgREST `or` filter for the notes a non-admin may see: the shared
 * ones, plus their own. The email is quoted as a PostgREST value; one that
 * can't be quoted safely (or a session with none) matches no author, so the
 * viewer gets the shared notes alone.
 */
export function visibleNotesFilter(email: string): string {
  if (!email || /["\\,()]/.test(email)) return 'admin_only.eq.false';
  return `admin_only.eq.false,author_email.eq."${email}"`;
}
