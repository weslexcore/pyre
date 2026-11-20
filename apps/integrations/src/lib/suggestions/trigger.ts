// When a suggestion run starts on its own: after a classification (called
// from the classifier's after-hook, lib/classify/activity, once a record's
// signals are saved), and after someone replies on a shift note (the
// replies route). The rules are ./eligibility.

import type { SupabaseClient } from '@supabase/supabase-js';
import { dispatchSuggestion } from './dispatch';
import { autoSuggestCheck, autoSuggestEnabled, suggestionsEnabled } from './eligibility';
import { createManualRun } from './runs';
import { SUGGESTION_SOURCES } from './sources';
import type { SuggestionSourceType } from './types';

/**
 * After a record's classification is saved: queue an automatic run if the
 * rules in ./eligibility allow one. Best-effort; never throws, since the classification
 * it follows has already been saved.
 */
export async function maybeSuggestAfterClassification(
  db: SupabaseClient,
  sourceType: SuggestionSourceType,
  sourceId: string,
  signals: unknown
): Promise<void> {
  if (!(await autoSuggestEnabled())) return;
  try {
    const check = await autoSuggestCheck(db, sourceType, sourceId, signals);
    if (check.ok) await dispatchSuggestion({ sourceType, sourceId, trigger: 'auto' });
  } catch (error) {
    console.error(`[suggestions] auto check for ${sourceType} ${sourceId} failed:`, error);
  }
}

/**
 * After someone wrote or edited a reply on a record: queue an automatic run
 * over the record and its thread, if the rules in ./eligibility allow one —
 * so a reply that answers the note ("we have 2 left, order a case") turns
 * into suggestions the same way the note would have. Best-effort; never
 * throws, since the reply it follows has already been saved.
 */
export async function maybeSuggestAfterReply(
  db: SupabaseClient,
  sourceType: SuggestionSourceType,
  sourceId: string
): Promise<void> {
  if (!(await autoSuggestEnabled())) return;
  try {
    const check = await autoSuggestCheck(db, sourceType, sourceId, null, { afterReply: true });
    if (check.ok) {
      await dispatchSuggestion({ sourceType, sourceId, trigger: 'auto', afterReply: true });
    }
  } catch (error) {
    console.error(`[suggestions] reply check for ${sourceType} ${sourceId} failed:`, error);
  }
}

/**
 * An admin ran the classifier on a record and asked for suggestions with it
 * (the AI button): now that the read is saved, file a run in their name and
 * start the agent — whatever the classifier found, since they asked. Skipped
 * while suggestions are off in Settings. Best-effort; never throws.
 */
export async function suggestForAdmin(
  db: SupabaseClient,
  sourceType: SuggestionSourceType,
  sourceId: string,
  requestedBy: string
): Promise<void> {
  try {
    if (!(await suggestionsEnabled())) return;
    const source = await SUGGESTION_SOURCES[sourceType].load(db, sourceId);
    if (!source) return;
    const filed = await createManualRun(db, source, requestedBy);
    if (!filed.ok) {
      console.error(
        `[suggestions] could not file a run for ${sourceType} ${sourceId}:`,
        filed.error
      );
      return;
    }
    await dispatchSuggestion({ sourceType, sourceId, trigger: 'manual', runId: filed.run.id });
  } catch (error) {
    console.error(
      `[suggestions] suggest after classifying ${sourceType} ${sourceId} failed:`,
      error
    );
  }
}
