// Where each subject keeps its history of classifications. Every run that
// saves an answer is also written to the record's own activity (for shift
// notes, an entry in the note's thread), so the page shows what Jev found
// each time it read the record, not only the latest answer. The Record type
// makes a new subject a type error here until it says where that goes.
//
// Kept apart from ./subjects (auth, page gates) so the background run can
// import it without pulling in the request-side modules.

import type { SubjectType } from '@pyre/signals-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordClassification } from '@/lib/shift-notes/activity';

export interface ClassifiedResult {
  signals: unknown;
  model: string | null;
  /** The admin who asked for the run; absent when a write triggered it. */
  requestedBy?: string;
}

export const CLASSIFICATION_RECORDERS: Record<
  SubjectType,
  (db: SupabaseClient, id: string, result: ClassifiedResult) => Promise<unknown>
> = {
  shift_note: recordClassification,
};
