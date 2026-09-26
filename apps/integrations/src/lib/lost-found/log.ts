// Audit trail for lost-and-found items: every mutation writes a
// lost_found_events row, so "who emailed whom, who handed it back, who drove
// it to Furbish" is on record (see lib/audit-log for the contract).

import type { SupabaseClient } from '@supabase/supabase-js';
import { auditLog } from '@/lib/audit-log';
import type { LostFoundEventRow } from '@/lib/db';

export interface LostFoundEventInput {
  itemId: string;
  action: LostFoundEventRow['action'];
  /** Session email, 'cron' for the sweep, or 'guest' for a claim-link click. */
  actor: string;
  detail?: Record<string, unknown>;
  note?: string | null;
}

const trail = auditLog<LostFoundEventRow>({
  table: 'lost_found_events',
  fkColumn: 'item_id',
  scope: 'lost-found',
});

export function logLostFoundEvent(
  db: SupabaseClient,
  { itemId, ...event }: LostFoundEventInput
): Promise<void> {
  return trail.log(db, { subjectId: itemId, ...event });
}

/** The full trail for one item, oldest first. */
export function loadLostFoundEvents(
  db: SupabaseClient,
  itemId: string
): Promise<LostFoundEventRow[]> {
  return trail.load(db, itemId);
}
