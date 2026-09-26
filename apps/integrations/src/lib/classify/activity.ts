// What each subject does with a saved answer. Every run that saves one is
// written to the record's own activity (for shift notes, an entry in the
// note's thread), so the page shows what the classifier found each time it
// read the record, not only the latest answer; a subject may also act on it
// (shift notes triage themselves: lib/shift-notes/triage, and may start an
// agent suggestion run: lib/suggestions/trigger). The Record type
// makes a new subject a type error here until it says what happens.
//
// Kept apart from ./subjects (auth, page gates) so the background run can
// import it without pulling in the request-side modules.

import type { SubjectType } from '@pyre/signals-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordClassification } from '@/lib/shift-notes/activity';
import { triageFromClassification } from '@/lib/shift-notes/triage';
import { maybeSuggestAfterClassification, suggestForAdmin } from '@/lib/suggestions/trigger';

export interface ClassifiedResult {
  signals: unknown;
  model: string | null;
  /** The admin who asked for the run; absent when a write triggered it. */
  requestedBy?: string;
  /** The admin also asked for suggestions (the AI button), so start them now. */
  thenSuggest?: boolean;
}

export const AFTER_CLASSIFIED: Record<
  SubjectType,
  (db: SupabaseClient, id: string, result: ClassifiedResult) => Promise<unknown>
> = {
  // The answer first, then the status it led to, so the thread reads in
  // order; then the suggester looks at the note — because the admin who ran
  // the classifier asked it to, or because it found work to do and automatic
  // suggestions are on (lib/suggestions/eligibility decides).
  async shift_note(db, id, result) {
    await recordClassification(db, id, result);
    await triageFromClassification(db, id, result.signals);
    if (result.thenSuggest && result.requestedBy) {
      await suggestForAdmin(db, 'shift_note', id, result.requestedBy);
    } else {
      await maybeSuggestAfterClassification(db, 'shift_note', id, result.signals);
    }
  },
};
