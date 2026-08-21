// Who hears about an incident, and when. A log nobody reads is not a safety
// system: a severe report filed at 9pm has to reach management that night,
// not at the next dashboard visit.
//
// The rule is deliberately narrow — severe/critical, anything that called EMS
// or the police, or a hospital transport. Minor scrapes and near misses stay
// in the log and get reviewed on their own schedule, so the alert keeps
// meaning something.

import type { SupabaseClient } from '@supabase/supabase-js';
import { INCIDENTS_MANAGE } from '@/components/admin/adminTools';
import { listStaff } from '@/lib/auth/access';
import type { IncidentRow } from '@/lib/db';
import { sendTemplate } from '@/lib/email/send';
import { logIncidentEvent } from './log';
import { areaLabel, categoryLabel, severityLabel, URGENT_SEVERITIES } from './types';

/** Whether this report should page management the moment it lands. */
export function isUrgent(incident: IncidentRow): boolean {
  return (
    URGENT_SEVERITIES.includes(incident.severity) ||
    incident.ems_called ||
    incident.police_called ||
    incident.transported_to_hospital
  );
}

/** Admins plus anyone trusted with the incident log. */
async function listIncidentRecipients(): Promise<string[]> {
  const rows = await listStaff();
  if (!rows) return [];
  return rows
    .filter((r) => r.email && (r.is_admin || r.pages.includes(INCIDENTS_MANAGE)))
    .map((r) => r.email as string);
}

/** "Tuesday, August 21 at 7:42 PM" in the bathhouse's wall-clock time. */
function formatOccurred(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Email the incident to management. Best-effort per recipient: one bad
 * address must not stop the rest, and a total email outage must not lose the
 * report — it is already saved by the time this runs. Records a 'notified'
 * event so the trail shows who was told.
 */
export async function notifyIncident(
  db: SupabaseClient,
  incident: IncidentRow,
  origin: string
): Promise<number> {
  const recipients = await listIncidentRecipients();
  if (recipients.length === 0) {
    console.warn(`[incidents] ${incident.reference} filed but nobody is set up to be notified`);
    return 0;
  }

  const injuredCount = (incident.affected_people as { injured?: boolean }[]).filter(
    (p) => p?.injured
  ).length;

  const props = {
    reference: incident.reference,
    severityLabel: severityLabel(incident.severity),
    categoryLabel: categoryLabel(incident.category),
    areaLabel: areaLabel(incident.area),
    occurredLabel: formatOccurred(incident.occurred_at),
    reportedByLabel: incident.reported_by_name || incident.reported_by,
    description: incident.description,
    immediateActions: incident.immediate_actions,
    injuredCount,
    emsCalled: incident.ems_called,
    incidentUrl: `${origin}/admin/incidents/${incident.id}`,
  };

  let sent = 0;
  const delivered: string[] = [];
  for (const to of recipients) {
    try {
      const result = await sendTemplate({
        to,
        template: 'incident-reported',
        props,
        kind: 'transactional',
        // One alert per incident per recipient, however the route retries.
        sendKey: `incident-reported:${incident.id}:${to}`,
      });
      if (result.status === 'sent') {
        sent += 1;
        delivered.push(to);
      }
    } catch (e) {
      console.error(`[incidents] alert to ${to} failed:`, e instanceof Error ? e.message : e);
    }
  }

  await logIncidentEvent(db, {
    incidentId: incident.id,
    action: 'notified',
    actor: 'system',
    detail: { recipients: delivered, attempted: recipients.length, reason: 'urgent' },
  });

  return sent;
}
