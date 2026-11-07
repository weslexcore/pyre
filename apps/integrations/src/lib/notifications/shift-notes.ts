// Shift-note activity → the inboxes of the people in the conversation. A
// reply reaches the note's author and the admins (minus whoever wrote it);
// a private reply stays with the admins, as the thread itself does. A
// status change reaches the author. Anyone a note or a reply @-mentions —
// among the people who can read it (lib/shift-notes/mentions) — hears about
// the mention instead of the ordinary notice, and an edit tells the people
// it newly names. Best-effort like every notifier.

import { formatShortDay } from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SHIFT_NOTES_HREF } from '@/components/admin/adminTools';
import { listStaff } from '@/lib/auth/access';
import type { ShiftNoteReplyRow, ShiftNoteRow } from '@/lib/db';
import { normalizeEmail } from '@/lib/email/address';
import { mentionsAsNames, namesOf, pageMentionCandidates } from '@/lib/mentions';
import { noteMentionPeople } from '@/lib/shift-notes/mentions';
import { notifyMentions, withoutMentioned } from './mentions';
import { createNotifications } from './notify';
import { adminEmails, nameFor, type RosterRow } from './recipients';
import { shiftNoteReplyText, shiftNoteStatusText } from './text';
import { daysFromNow, excerpt } from './types';

const NOTE_NOTICE_DAYS = 30;

type NoteSubject = Pick<ShiftNoteRow, 'id' | 'note_date' | 'author_email' | 'admin_only'>;

function noteHref(noteId: string): string {
  return `${SHIFT_NOTES_HREF}#note-${noteId}`;
}

/** 'the shift note for Sat, Sep 20' */
function notePhrase(note: Pick<ShiftNoteRow, 'note_date'>): string {
  return `the shift note for ${formatShortDay(note.note_date)}`;
}

/** The people a note (or a reply on it) may name, from the page's holders. */
function readersOf(rows: RosterRow[], note: NoteSubject, privateReply = false) {
  return noteMentionPeople(pageMentionCandidates(rows, SHIFT_NOTES_HREF), note, {
    privateReply,
  });
}

/**
 * A note was written or its text edited: tell the people it @-mentions
 * (on an edit, only the ones the new text adds). Nothing else about a new
 * note is announced — the log is read, not pushed.
 */
export async function notifyShiftNoteMentions(
  db: SupabaseClient,
  note: NoteSubject & Pick<ShiftNoteRow, 'body'>,
  actorEmail: string,
  previousBody?: string
): Promise<void> {
  const rows = (await listStaff()) ?? [];
  await notifyMentions(db, {
    text: note.body,
    previousText: previousBody,
    people: readersOf(rows, note),
    actorEmail,
    where: notePhrase(note),
    href: noteHref(note.id),
    source: { type: 'shift_note', id: note.id },
    expiresAt: daysFromNow(NOTE_NOTICE_DAYS),
  });
}

export async function notifyShiftNoteReply(
  db: SupabaseClient,
  note: NoteSubject,
  reply: Pick<ShiftNoteReplyRow, 'id' | 'body' | 'author_email' | 'is_private'>
): Promise<void> {
  const rows = (await listStaff()) ?? [];
  const replier = normalizeEmail(reply.author_email);
  const author = note.author_email.trim().toLowerCase();
  const replierName = nameFor(rows, replier);
  const base = {
    kind: 'shift_note_reply' as const,
    href: noteHref(note.id),
    source: { type: 'shift_note', id: note.id },
    actorEmail: replier,
    expiresAt: daysFromNow(NOTE_NOTICE_DAYS),
  };
  const people = readersOf(rows, note, reply.is_private);
  const mentioned = await notifyMentions(db, {
    text: reply.body,
    people,
    actorEmail: replier,
    where: `a reply on ${notePhrase(note)}`,
    href: base.href,
    source: base.source,
    expiresAt: base.expiresAt,
  });
  const body = excerpt(mentionsAsNames(reply.body, namesOf(people)), 160);

  if (!reply.is_private && author && author !== replier && !mentioned.includes(author)) {
    await createNotifications(db, [author], {
      ...base,
      ...shiftNoteReplyText({
        noteDate: note.note_date,
        replierName,
        forAuthor: true,
        excerpt: body,
      }),
    });
  }
  await createNotifications(
    db,
    withoutMentioned(
      adminEmails(rows).filter((email) => email !== author),
      mentioned
    ),
    {
      ...base,
      ...shiftNoteReplyText({
        noteDate: note.note_date,
        replierName,
        forAuthor: false,
        authorName: `${nameFor(rows, author)}'s`,
        excerpt: body,
      }),
    }
  );
}

/** A reply was edited: tell the people its new text @-mentions that the old one didn't. */
export async function notifyShiftNoteReplyEdited(
  db: SupabaseClient,
  note: NoteSubject,
  reply: Pick<ShiftNoteReplyRow, 'body' | 'is_private'>,
  previousBody: string,
  editorEmail: string
): Promise<void> {
  const rows = (await listStaff()) ?? [];
  await notifyMentions(db, {
    text: reply.body,
    previousText: previousBody,
    people: readersOf(rows, note, reply.is_private),
    actorEmail: editorEmail,
    where: `a reply on ${notePhrase(note)}`,
    href: noteHref(note.id),
    source: { type: 'shift_note', id: note.id },
    expiresAt: daysFromNow(NOTE_NOTICE_DAYS),
  });
}

export async function notifyShiftNoteStatus(
  db: SupabaseClient,
  note: Pick<ShiftNoteRow, 'id' | 'note_date' | 'author_email'>,
  status: string,
  adminEmail: string
): Promise<void> {
  const rows = (await listStaff()) ?? [];
  await createNotifications(db, [note.author_email], {
    kind: 'shift_note_reply',
    ...shiftNoteStatusText({
      noteDate: note.note_date,
      status,
      adminName: nameFor(rows, adminEmail),
    }),
    href: noteHref(note.id),
    source: { type: 'shift_note', id: note.id },
    actorEmail: adminEmail,
    expiresAt: daysFromNow(NOTE_NOTICE_DAYS),
    supersede: true,
  });
}
