// A shift note's activity: every action on a note is written into its thread
// (shift_note_replies) as an event next to the comments, so the page can show
// how a note got where it is — who moved it to "to do", who edited it, what
// Jev found each time it read it — instead of only the latest stamp on the
// card. Comments are written by the replies route; this records the rest.
//
// Recording is best-effort: the action itself (the status flip, the edit,
// the classification) has already been saved, and a lost history entry must
// never fail it. Each recorder returns the row it wrote, or null.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ShiftNoteActivityData, ShiftNoteReplyRow, ShiftNoteStatus } from '@/lib/db';

async function record(
  db: SupabaseClient,
  row: Pick<ShiftNoteReplyRow, 'note_id' | 'kind' | 'author_email' | 'is_private'> & {
    data: ShiftNoteActivityData;
  }
): Promise<ShiftNoteReplyRow | null> {
  try {
    const { data, error } = await db
      .from('shift_note_replies')
      .insert({ ...row, body: '' })
      .select('*')
      .single();
    if (error) {
      console.error(`[shift-notes] could not record ${row.kind}:`, error.message);
      return null;
    }
    return data as ShiftNoteReplyRow;
  } catch (error) {
    console.error(`[shift-notes] could not record ${row.kind}:`, error);
    return null;
  }
}

/** An admin moved the note between statuses. Shared with the author, like the badge. */
export function recordStatusChange(
  db: SupabaseClient,
  noteId: string,
  from: ShiftNoteStatus,
  to: ShiftNoteStatus,
  by: string
): Promise<ShiftNoteReplyRow | null> {
  return record(db, {
    note_id: noteId,
    kind: 'status',
    author_email: by,
    is_private: false,
    data: { from, to },
  });
}

/** The note's text or date changed. Shared with the author, who may have made it. */
export function recordEdit(
  db: SupabaseClient,
  noteId: string,
  fields: Array<'body' | 'note_date'>,
  by: string
): Promise<ShiftNoteReplyRow | null> {
  return record(db, {
    note_id: noteId,
    kind: 'edit',
    author_email: by,
    is_private: false,
    data: { fields },
  });
}

/**
 * Jev read the note. Admins only, like the signal chips; `requestedBy` is the
 * admin who asked for the run, absent when a write triggered it.
 */
export function recordClassification(
  db: SupabaseClient,
  noteId: string,
  result: { signals: unknown; model: string | null; requestedBy?: string }
): Promise<ShiftNoteReplyRow | null> {
  return record(db, {
    note_id: noteId,
    kind: 'classification',
    author_email: null,
    is_private: true,
    data: {
      signals: result.signals,
      model: result.model,
      ...(result.requestedBy ? { requested_by: result.requestedBy } : {}),
    },
  });
}
