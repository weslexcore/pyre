// Read side for AdminLayout: how many agent suggestions are waiting for an
// admin, for the count beside Suggestions in the menu. Server-only. Never
// blocks a page render — no storage, or a failed query, reads as zero.

import { getDb } from '@/lib/db';
import { countPending } from './store';

export async function getPendingSuggestionCount(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  return countPending(db);
}
