// Audit trail for incident reports: every mutation in /api/admin/incidents
// writes an incident_events row (see lib/audit-log for the contract).

import type { SupabaseClient } from '@supabase/supabase-js';
import { auditLog } from '@/lib/audit-log';
import type { IncidentEventRow } from '@/lib/db';

export interface IncidentEventInput {
  incidentId: string;
  action: IncidentEventRow['action'];
  /** Session email of whoever did it, or 'cron' for automated sweeps. */
  actor: string;
  detail?: Record<string, unknown>;
  note?: string | null;
}

const trail = auditLog<IncidentEventRow>({
  table: 'incident_events',
  fkColumn: 'incident_id',
  scope: 'incidents',
});

export function logIncidentEvent(
  db: SupabaseClient,
  { incidentId, ...event }: IncidentEventInput
): Promise<void> {
  return trail.log(db, { subjectId: incidentId, ...event });
}

/** The full trail for one incident, oldest first — how a report reads as a story. */
export function loadIncidentEvents(
  db: SupabaseClient,
  incidentId: string
): Promise<IncidentEventRow[]> {
  return trail.load(db, incidentId);
}
