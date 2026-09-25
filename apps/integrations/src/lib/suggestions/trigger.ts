// When a classification should start a suggestion run on its own. Called
// from the classifier's after-hook (lib/classify/activity) once a record's
// signals are saved; the rules are ./eligibility.

import type { SupabaseClient } from '@supabase/supabase-js';
import { dispatchSuggestion } from './dispatch';
import { autoSuggestCheck, autoSuggestEnabled } from './eligibility';
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
  if (!autoSuggestEnabled()) return;
  try {
    const check = await autoSuggestCheck(db, sourceType, sourceId, signals);
    if (check.ok) await dispatchSuggestion({ sourceType, sourceId, trigger: 'auto' });
  } catch (error) {
    console.error(`[suggestions] auto check for ${sourceType} ${sourceId} failed:`, error);
  }
}
