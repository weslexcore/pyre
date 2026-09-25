// Who may see and do what on shift notes. Everyone on the roster writes them,
// but the log is not a shared feed: an admin reads every note, and everyone
// else reads only the ones they wrote themselves. Reading and editing a note
// land on the same rule — if you can see a note you may edit or delete it,
// and there is nothing you can edit that you cannot see — so the notes route
// and the media route gate on this one predicate.
//
// On top of a note sit two things only the thread needs rules for:
//
//   * status — open / todo / resolved, set by admins only; the author sees it.
//   * activity — the note's thread. Anyone who can see the note may comment
//     (an admin, or the author on their own note); an entry is visible to
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

/** The author attribution of a note — the part of the row this rule reads. */
export interface AuthoredNote {
  author_email: string;
}

/** The parts of a reply row the visibility and edit rules read. */
export interface ReplyLike {
  author_email: string | null;
  is_private: boolean;
  /** Absent reads as a comment. */
  kind?: ShiftNoteActivityKind;
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

/** Replying is the same circle as seeing: the admins, and the author on their own note. */
export function canReply(note: AuthoredNote, viewer: NoteViewer): boolean {
  return canSeeNote(note, viewer);
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
