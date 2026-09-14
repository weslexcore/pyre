// Who an automatic notification reaches, decided over the staff roster —
// pure functions over StaffRow[] so the rules are testable, with the roster
// fetched by the callers (the cached listStaff in lib/auth/access).
//
// Everyone active on the roster with an email has dashboard access (the
// implicit shift-notes grant in lib/auth/access), so they can open the
// inbox. Whether they can open the page an event lives on is a separate
// question, answered per event: an SOP notice only goes to people who can
// read that SOP, and a schedule notice reaches the person scheduled either
// way but links to the board only when they hold the schedule page.

import { canViewPage } from '@/components/admin/adminTools';
import type { StaffRow } from '@/lib/db';
import { canViewSop, roleForStaffRow, type SopAccessFields } from '@/lib/sops/levels';

export type RosterRow = Pick<
  StaffRow,
  'id' | 'email' | 'display_name' | 'active' | 'is_admin' | 'is_shift_lead' | 'pages'
>;

function emailOf(row: RosterRow): string {
  return (row.email ?? '').trim().toLowerCase();
}

/** Active roster rows that can receive anything at all. */
export function dashboardRecipients(rows: RosterRow[]): RosterRow[] {
  return rows.filter((row) => row.active && emailOf(row));
}

export function adminEmails(rows: RosterRow[]): string[] {
  return dashboardRecipients(rows)
    .filter((row) => row.is_admin)
    .map(emailOf);
}

/**
 * Everyone who could open the SOP: holds the SOP page and may read this
 * document under its grants. The editor is dropped by the notifier.
 */
export function sopUpdateRecipients(rows: RosterRow[], sop: SopAccessFields): string[] {
  return dashboardRecipients(rows)
    .filter(
      (row) =>
        canViewPage({ isAdmin: row.is_admin, pages: row.pages ?? [] }, '/admin/sops') &&
        canViewSop({ role: roleForStaffRow(row), email: emailOf(row) }, sop)
    )
    .map(emailOf);
}

/** Whether this person can open the schedule board (for the notice's link). */
export function canOpenSchedule(row: RosterRow): boolean {
  return canViewPage({ isAdmin: row.is_admin, pages: row.pages ?? [] }, '/admin/schedule');
}

/** Roster row by staff id, for turning an assignment's staff_id into a person. */
export function rosterById(rows: RosterRow[]): Map<string, RosterRow> {
  return new Map(rows.map((row) => [row.id, row]));
}

/** Roster row by lowercased email. */
export function rosterByEmail(rows: RosterRow[]): Map<string, RosterRow> {
  const map = new Map<string, RosterRow>();
  for (const row of rows) {
    const email = emailOf(row);
    if (email) map.set(email, row);
  }
  return map;
}

/** Display name for an email, falling back to the local part. */
export function nameFor(rows: RosterRow[], email: string | null | undefined): string {
  const normalized = (email ?? '').trim().toLowerCase();
  if (!normalized) return 'Someone';
  const row = rosterByEmail(rows).get(normalized);
  const name = (row?.display_name ?? '').trim();
  if (name) return name;
  return normalized.includes('@') ? normalized.slice(0, normalized.indexOf('@')) : normalized;
}
