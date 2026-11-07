// Who may be @-mentioned in an incident's follow-up notes: the people who
// can open the report — whoever holds incidents:manage (or is an admin with
// the page), and the person who filed it. Pure, over the roster; the route
// serves the list with the report and the notifier reads the same one.

import { canViewPage, hasIncidentsManage } from '@/components/admin/adminTools';
import type { IncidentRow } from '@/lib/db';
import { normalizeEmail } from '@/lib/email/address';
import { type MentionPerson, mentionCandidates } from '@/lib/mentions';
import { accessOf, type RosterRow } from '@/lib/notifications/recipients';
import { canUseDashboard } from '@/lib/sops/levels';

const INCIDENTS_PAGE = '/admin/incidents';

export function incidentMentionPeople(
  rows: RosterRow[],
  incident: Pick<IncidentRow, 'reported_by'>
): MentionPerson[] {
  const reporter = normalizeEmail(incident.reported_by);
  return mentionCandidates(rows, (row) => {
    if (!canUseDashboard(row)) return false;
    const access = accessOf(row);
    return (
      hasIncidentsManage(access) ||
      (normalizeEmail(row.email) === reporter && canViewPage(access, INCIDENTS_PAGE))
    );
  }).map(({ email, name }) => ({ email, name }));
}
