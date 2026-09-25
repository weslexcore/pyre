// Shift-note activity → the inboxes of the people in the conversation. A
// reply reaches the note's author and the admins (minus whoever wrote it);
// a private reply stays with the admins, as the thread itself does. A
// status change reaches the author. Best-effort like every notifier.

import type { SupabaseClient } from '@supabase/supabase-js';
import { listStaff } from '@/lib/auth/access';
import type { ShiftNoteReplyRow, ShiftNoteRow } from '@/lib/db';
import { createNotifications } from './notify';
import { adminEmails, nameFor } from './recipients';
import { shiftNoteReplyText, shiftNoteStatusText } from './text';
import { daysFromNow, excerpt } from './types';

const NOTE_NOTICE_DAYS = 30;

function noteHref(noteId: string): string {
  return `/admin/shift-notes#note-${noteId}`;
}

export async function notifyShiftNoteReply(
  db: SupabaseClient,
  note: Pick<ShiftNoteRow, 'id' | 'note_date' | 'author_email'>,
  reply: Pick<ShiftNoteReplyRow, 'id' | 'body' | 'author_email' | 'is_private'>
): Promise<void> {
  const rows = (await listStaff()) ?? [];
  const replier = (reply.author_email ?? '').trim().toLowerCase();
  const author = note.author_email.trim().toLowerCase();
  const replierName = nameFor(rows, replier);
  const base = {
    kind: 'shift_note_reply' as const,
    href: noteHref(note.id),
    source: { type: 'shift_note', id: note.id },
    actorEmail: replier,
    expiresAt: daysFromNow(NOTE_NOTICE_DAYS),
  };
  const body = excerpt(reply.body, 160);

  if (!reply.is_private && author && author !== replier) {
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
    adminEmails(rows).filter((email) => email !== author),
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
