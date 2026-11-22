// Whether a shift note matches a search term: its own text, or any comment in
// its thread the viewer may read. A note is a conversation — the answer to
// "where do we keep the spare filters?" is often a reply — so the global
// search (/api/admin/search) and the log's own filter (ShiftNotes) both
// match the whole visible thread, with the one matcher the highlights use
// (spaces and hyphens ignored). Events (status changes, edits,
// classifications) are not text anyone wrote and are never matched.
// Client-bundle-safe.

import { matchesTerm, searchEntries } from '@/lib/sops/search';
import { canSeeReply, type NoteViewer, type ReplyLike } from './access';

export interface SearchableReply extends ReplyLike {
  body: string;
}

export interface NoteMatch {
  /** The matched line, cleaned for display. */
  snippet: string;
  /** Who wrote the reply it matched in; absent when the note itself matched. */
  replyAuthor?: string;
}

/** The comments in a thread the viewer may read. */
function readableComments<R extends SearchableReply>(
  replies: readonly R[],
  viewer: NoteViewer
): R[] {
  return replies.filter(
    (reply) => (reply.kind ?? 'comment') === 'comment' && canSeeReply(reply, viewer)
  );
}

/**
 * Where `term` lands in a note's thread: the note's own text first, else the
 * first readable comment (in thread order) that contains it. Null when
 * neither does. The caller has already checked the viewer can see the note.
 */
export function matchNote(
  body: string,
  replies: readonly SearchableReply[],
  term: string,
  viewer: NoteViewer
): NoteMatch | null {
  const [own] = searchEntries(body, term, 1).entries;
  if (own) return { snippet: own.text };
  for (const reply of readableComments(replies, viewer)) {
    const [entry] = searchEntries(reply.body, term, 1).entries;
    if (entry) return { snippet: entry.text, replyAuthor: reply.author_email ?? undefined };
  }
  return null;
}

/**
 * Whether the log's filter keeps a note: `term` in its text or in a readable
 * comment. The boolean twin of matchNote, on the matcher the log's
 * highlights use (no minimum length — the log filters as you type).
 */
export function threadMatches(
  body: string,
  replies: readonly SearchableReply[],
  term: string,
  viewer: NoteViewer
): boolean {
  if (matchesTerm(body, term)) return true;
  return readableComments(replies, viewer).some((reply) => matchesTerm(reply.body, term));
}
