// How a list of suggestions is laid out for review: the inventory changes
// one agent run proposed together (several counts and new items read out of
// one note, or out of the notes Pyre Agent read in a chat) gather into one
// batch an admin can approve in a click; everything else stays a card of its
// own. Pure and client-bundle-safe.

import { isInventorySuggestionKind, type SuggestionView } from '@/lib/suggestions/types';

export type ReviewEntry =
  | { type: 'single'; suggestion: SuggestionView }
  | { type: 'inventory'; key: string; suggestions: SuggestionView[] };

function isOpen(s: SuggestionView): boolean {
  return s.status === 'pending' || s.status === 'applying';
}

/**
 * The list in its own order, with each run's open inventory suggestions
 * gathered where the first of them stands. A run with only one gets no batch
 * (a single card says it better), and decided ones are never batched.
 */
export function groupForReview(suggestions: readonly SuggestionView[]): ReviewEntry[] {
  const byRun = new Map<string, SuggestionView[]>();
  for (const s of suggestions) {
    if (!isOpen(s) || !isInventorySuggestionKind(s.kind)) continue;
    const list = byRun.get(s.run_id) ?? [];
    list.push(s);
    byRun.set(s.run_id, list);
  }
  const out: ReviewEntry[] = [];
  const placed = new Set<string>();
  for (const s of suggestions) {
    const batch = isOpen(s) && isInventorySuggestionKind(s.kind) ? byRun.get(s.run_id) : undefined;
    if (!batch || batch.length < 2) {
      out.push({ type: 'single', suggestion: s });
      continue;
    }
    if (placed.has(s.run_id)) continue;
    placed.add(s.run_id);
    out.push({ type: 'inventory', key: s.run_id, suggestions: batch });
  }
  return out;
}
