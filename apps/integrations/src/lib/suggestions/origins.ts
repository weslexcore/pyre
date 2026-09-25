// Where approved suggestions came from, for the records they made — an SOP
// version's history row links back to the shift note behind it. Server-only.

import type { SupabaseClient } from '@supabase/supabase-js';
import { type SourceRecord, SUGGESTION_SOURCES } from './sources';
import { isSuggestionSourceType, type SuggestionResultLink } from './types';

/**
 * The source record behind each suggestion, keyed by suggestion id: its label
 * and a link to it, or a label alone when the record has since been deleted.
 * Suggestions that can't be found are left out.
 */
export async function suggestionOrigins(
  db: SupabaseClient,
  suggestionIds: readonly string[]
): Promise<Record<string, SuggestionResultLink>> {
  const out: Record<string, SuggestionResultLink> = {};
  const ids = [...new Set(suggestionIds)];
  if (ids.length === 0) return out;

  const { data, error } = await db
    .from('agent_suggestions')
    .select('id, source_type, source_id')
    .in('id', ids);
  if (error) {
    console.error('[suggestions] origin read failed:', error.message);
    return out;
  }
  const rows = (data ?? []) as { id: string; source_type: string; source_id: string }[];

  const byType = new Map<string, string[]>();
  for (const row of rows) {
    const list = byType.get(row.source_type) ?? [];
    list.push(row.source_id);
    byType.set(row.source_type, list);
  }
  const records = new Map<string, SourceRecord>();
  for (const [type, sourceIds] of byType) {
    if (!isSuggestionSourceType(type)) continue;
    const found = await SUGGESTION_SOURCES[type]
      .loadMany(db, sourceIds)
      .catch(() => new Map<string, SourceRecord>());
    for (const [id, record] of found) records.set(`${type}:${id}`, record);
  }

  for (const row of rows) {
    const record = records.get(`${row.source_type}:${row.source_id}`);
    out[row.id] = record
      ? { label: record.label, href: record.href }
      : { label: 'a shift note that has since been deleted', href: null };
  }
  return out;
}
