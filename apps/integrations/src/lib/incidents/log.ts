// Audit-trail writer for incident reports. Every mutation in
// /api/admin/incidents goes through here, so "who changed what, when" is a
// property of the system rather than something each route remembers to do.
//
// Server-only (takes a service-role client). Failures are logged and
// swallowed: losing an audit line is bad, but failing the staff member's
// report — or their status change — because the trail write failed would be
// worse. The row itself is already saved by the time we get here.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IncidentEventRow } from '@/lib/db';

export interface IncidentEventInput {
  incidentId: string;
  action: IncidentEventRow['action'];
  /** Session email of whoever did it, or 'cron' for automated sweeps. */
  actor: string;
  detail?: Record<string, unknown>;
  note?: string | null;
}

export async function logIncidentEvent(
  db: SupabaseClient,
  event: IncidentEventInput
): Promise<void> {
  const { error } = await db.from('incident_events').insert({
    incident_id: event.incidentId,
    action: event.action,
    actor: event.actor,
    detail: event.detail ?? {},
    note: event.note ?? null,
  });

  if (error) {
    console.error(`[incidents] audit write failed (${event.action}):`, error.message);
  }
}

/** The full trail for one incident, oldest first — how a report reads as a story. */
export async function loadIncidentEvents(
  db: SupabaseClient,
  incidentId: string
): Promise<IncidentEventRow[]> {
  const { data, error } = await db
    .from('incident_events')
    .select('*')
    .eq('incident_id', incidentId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[incidents] audit read failed:', error.message);
    return [];
  }
  return (data ?? []) as IncidentEventRow[];
}
