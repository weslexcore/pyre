// Who may be @-mentioned on a shift note and in its thread: the people who
// can read it. The candidates start from everyone holding the shift-notes
// page (the server's pageMentionCandidates, served to the islands by
// /api/admin/mention-people) and narrow by the note: an admins-only note is
// read by the admins and its author, and a private reply by the admins
// alone. Client-bundle-safe — the composer and the log apply the same rule
// the notifier does.

import { SHIFT_NOTES_HREF } from '@/components/admin/adminTools';
import type { MentionCandidate, MentionPerson } from '@/lib/mentions';
import { canSeeNote, type VisibleNote } from './access';

/** Where the islands fetch the page's holders from. */
export const SHIFT_NOTE_MENTION_PEOPLE_URL = `/api/admin/mention-people?page=${encodeURIComponent(SHIFT_NOTES_HREF)}`;

export function noteMentionPeople(
  holders: readonly MentionCandidate[],
  note: VisibleNote,
  options: { privateReply?: boolean } = {}
): MentionPerson[] {
  return holders
    .filter((person) =>
      options.privateReply
        ? person.isAdmin
        : canSeeNote(note, { email: person.email, isAdmin: person.isAdmin })
    )
    .map(({ email, name }) => ({ email, name }));
}
