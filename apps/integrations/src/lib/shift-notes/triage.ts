// Triage by the classifier: once it has read a shift note, the note's status
// follows what it found. Anything actionable (an action, a question, a record
// to update, a safety concern — @pyre/signals-core's `actionable` flag) puts
// the note on the to-do list; a purely informational note is resolved, since
// nobody owes anything on it.
//
// Admins stay in charge: the classifier only moves a note no admin has set a
// status on (status_by is null), and leaves status_by/status_at null itself,
// so a later read — after the author edits the note — can triage it again,
// while an admin's choice, once made, is never overridden. The update is
// guarded on both, so an admin triaging mid-read wins.
//
// Each move is recorded in the note's activity. Best-effort and never
// throws: the classification is already saved, and a missed triage leaves
// the note open for an admin, as before.

import { hasActionableSignal, readStoredSignals } from '@pyre/signals-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ShiftNoteRow, ShiftNoteStatus } from '@/lib/db';
import { recordClassifierStatusChange } from './activity';

/** The status a classification calls for: to do when anything is owed, else resolved. */
export function triageStatus(signals: unknown): ShiftNoteStatus {
  return hasActionableSignal(readStoredSignals(signals)) ? 'todo' : 'resolved';
}

/** Move an untriaged note to the status its classification calls for. Returns the new status, or null when nothing moved. */
export async function triageFromClassification(
  db: SupabaseClient,
  noteId: string,
  signals: unknown
): Promise<ShiftNoteStatus | null> {
  try {
    const { data, error } = await db
      .from('shift_notes')
      .select('status, status_by')
      .eq('id', noteId)
      .maybeSingle();
    if (error || !data) return null;
    const note = data as Pick<ShiftNoteRow, 'status' | 'status_by'>;
    if (note.status_by !== null) return null;

    const to = triageStatus(signals);
    if (note.status === to) return null;

    const { data: moved, error: moveError } = await db
      .from('shift_notes')
      .update({ status: to })
      .eq('id', noteId)
      .is('status_by', null)
      .eq('status', note.status)
      .select('id')
      .maybeSingle();
    if (moveError) {
      console.error('[shift-notes] triage failed:', moveError.message);
      return null;
    }
    // An admin set the status, or another read moved it, in the meantime.
    if (!moved) return null;

    await recordClassifierStatusChange(db, noteId, note.status, to);
    return to;
  } catch (error) {
    console.error('[shift-notes] triage failed:', error);
    return null;
  }
}
