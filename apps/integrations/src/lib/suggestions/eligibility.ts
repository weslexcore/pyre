// Whether a record should get an automatic suggestion run: a record is
// looked at automatically at most once per version of its text (the runs
// table's unique index), and not at all while that version has a dismissed
// suggestion — an admin already said no to what it would propose. Editing
// the text makes it eligible again. An admin's Suggest button skips all this.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSetting } from '@/lib/settings/store';
import { suggesterConfigured } from './session';
import { SUGGESTION_SOURCES } from './sources';
import type { SuggestionSourceType } from './types';

/** Whether suggestions are on at all (the Suggest button, and anything automatic). */
export async function suggestionsEnabled(): Promise<boolean> {
  return (await getSetting('suggestions.enabled')) && suggesterConfigured();
}

/** Whether classifications may start runs on their own (both settings on). */
export async function autoSuggestEnabled(): Promise<boolean> {
  return (await suggestionsEnabled()) && (await getSetting('suggestions.auto'));
}

/** The rule itself, apart from the reads it needs. */
export function shouldAutoSuggest(input: {
  enabled: boolean;
  eligible: boolean;
  /** An auto run already exists for this version of the text. */
  alreadyRun: boolean;
  /** A suggestion made from this version of the text was dismissed. */
  dismissed: boolean;
}): boolean {
  return input.enabled && input.eligible && !input.alreadyRun && !input.dismissed;
}

/** Whether this version of a record's text should get an automatic run now. */
export async function autoSuggestCheck(
  db: SupabaseClient,
  sourceType: SuggestionSourceType,
  sourceId: string,
  signals: unknown
): Promise<{ ok: boolean; hash?: string }> {
  const source = await SUGGESTION_SOURCES[sourceType].load(db, sourceId);
  if (!source) return { ok: false };
  const [{ count: runs }, { count: dismissed }] = await Promise.all([
    db
      .from('agent_suggestion_runs')
      .select('id', { count: 'exact', head: true })
      .eq('source_type', sourceType)
      .eq('source_id', sourceId)
      .eq('source_hash', source.hash)
      .eq('trigger', 'auto'),
    db
      .from('agent_suggestions')
      .select('id', { count: 'exact', head: true })
      .eq('source_type', sourceType)
      .eq('source_id', sourceId)
      .eq('source_hash', source.hash)
      .eq('status', 'dismissed'),
  ]);
  return {
    ok: shouldAutoSuggest({
      enabled: await autoSuggestEnabled(),
      eligible: SUGGESTION_SOURCES[sourceType].autoEligible(
        source,
        signals,
        await getSetting('suggestions.autoSignals')
      ),
      alreadyRun: (runs ?? 0) > 0,
      dismissed: (dismissed ?? 0) > 0,
    }),
    hash: source.hash,
  };
}
