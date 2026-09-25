// A shift note's activity: every action on a note is written into its thread
// (shift_note_replies) as an event next to the comments, so the page can show
// how a note got where it is — who moved it to "to do", who edited it, what
// the classifier found each time it read it — instead of only the latest
// stamp on the card. Comments are written by the replies route; this records
// the rest.
//
// Recording is best-effort: the action itself (the status flip, the edit,
// the classification) has already been saved, and a lost history entry must
// never fail it. Each recorder returns the row it wrote, or null.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ShiftNoteActivityData,
  ShiftNoteReplyRow,
  ShiftNoteRow,
  ShiftNoteStatus,
} from '@/lib/db';

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

/**
 * The classifier triaged a note no admin has (./triage). Admins only, like
 * everything else the classifier writes; the author still sees the badge.
 */
export function recordClassifierStatusChange(
  db: SupabaseClient,
  noteId: string,
  from: ShiftNoteStatus,
  to: ShiftNoteStatus
): Promise<ShiftNoteReplyRow | null> {
  return record(db, {
    note_id: noteId,
    kind: 'status',
    author_email: null,
    is_private: true,
    data: { from, to, source: 'classifier' },
  });
}

/**
 * The note's text or date changed: what changed, from what, to what — so the
 * history keeps every version of the note, not just the latest. Returns null
 * (records nothing) when neither field actually changed. Shared with the
 * author, who may have made it.
 */
export function recordEdit(
  db: SupabaseClient,
  before: Pick<ShiftNoteRow, 'id' | 'body' | 'note_date'>,
  after: Pick<ShiftNoteRow, 'body' | 'note_date'>,
  by: string
): Promise<ShiftNoteReplyRow | null> {
  const fields = (['body', 'note_date'] as const).filter((f) => before[f] !== after[f]);
  if (fields.length === 0) return Promise.resolve(null);
  return record(db, {
    note_id: before.id,
    kind: 'edit',
    author_email: by,
    is_private: false,
    data: {
      fields,
      before: Object.fromEntries(fields.map((f) => [f, before[f]])),
      after: Object.fromEntries(fields.map((f) => [f, after[f]])),
    },
  });
}

/**
 * The classifier read the note. Admins only, like the signal chips;
 * `requestedBy` is the admin who asked for the run, absent when a write
 * triggered it.
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

/**
 * An admin decided one of the note's agent suggestions: approved it (with a
 * link to the card or SOP version it made) or dismissed it. Admins only, like
 * the suggestions themselves.
 */
export function recordSuggestionDecision(
  db: SupabaseClient,
  noteId: string,
  decision: {
    suggestionId: string;
    kind: string;
    action: 'approved' | 'dismissed';
    by: string;
    result?: { type: string; id: string; href: string | null; label: string };
  }
): Promise<ShiftNoteReplyRow | null> {
  return record(db, {
    note_id: noteId,
    kind: 'suggestion',
    author_email: decision.by,
    is_private: true,
    data: {
      suggestion_id: decision.suggestionId,
      suggestion_kind: decision.kind,
      action: decision.action,
      ...(decision.result ? { result: decision.result } : {}),
    },
  });
}
