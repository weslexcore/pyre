// Read side for AdminLayout: the badge count the header paints before the
// bell island hydrates. Server-only (imports getDb). Never blocks a page
// render — no storage, or a failed query, reads as zero.

import { getDb } from '@/lib/db';
import { countUnread } from './notify';

export async function getUnreadCount(email: string): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  return countUnread(db, email);
}
