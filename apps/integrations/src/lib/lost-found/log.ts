// Audit-trail writer for lost-and-found items. Every mutation goes through
// here, so "who emailed whom, who handed it back, who drove it to Furbish" is
// a property of the system rather than something each route remembers to do.
//
// Server-only (takes a service-role client). Failures are logged and
// swallowed: losing an audit line is bad, but failing a staff member's status
// change because the trail write failed would be worse. The row itself is
// already saved by the time we get here.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LostFoundEventRow } from '@/lib/db';

export interface LostFoundEventInput {
  itemId: string;
  action: LostFoundEventRow['action'];
  /** Session email, 'cron' for the sweep, or 'guest' for a claim-link click. */
  actor: string;
  detail?: Record<string, unknown>;
  note?: string | null;
}

export async function logLostFoundEvent(
  db: SupabaseClient,
  event: LostFoundEventInput
): Promise<void> {
  const { error } = await db.from('lost_found_events').insert({
    item_id: event.itemId,
    action: event.action,
    actor: event.actor,
    detail: event.detail ?? {},
    note: event.note ?? null,
  });

  if (error) {
    console.error(`[lost-found] audit write failed (${event.action}):`, error.message);
  }
}

/** The full trail for one item, oldest first. */
export async function loadLostFoundEvents(
  db: SupabaseClient,
  itemId: string
): Promise<LostFoundEventRow[]> {
  const { data, error } = await db
    .from('lost_found_events')
    .select('*')
    .eq('item_id', itemId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[lost-found] audit read failed:', error.message);
    return [];
  }
  return (data ?? []) as LostFoundEventRow[];
}
