// The staff name directory the SOP responses carry, so the UI can show who
// started a run, checked an item, or edited a document by name instead of by
// email. Server-only (reads the staff table via the cached roster in
// lib/auth/access); the rendering half lives in names.ts.

import { listStaff } from '@/lib/auth/access';
import type { SopRole } from './levels';
import type { PeopleNames } from './names';

/**
 * Names for exactly the emails a response is about — never the whole roster,
 * so a response can't turn into a staff address book for anyone who can read
 * one SOP. Emails with no roster row are simply absent (the UI falls back).
 */
export async function getPeopleNames(emails: Iterable<string>): Promise<PeopleNames> {
  const wanted = new Set<string>();
  for (const email of emails) {
    const normalized = email.trim().toLowerCase();
    if (normalized) wanted.add(normalized);
  }
  if (wanted.size === 0) return {};

  const rows = await listStaff();
  const names: PeopleNames = {};
  for (const row of rows ?? []) {
    const email = (row.email ?? '').trim().toLowerCase();
    const name = (row.display_name ?? '').trim();
    if (email && name && wanted.has(email)) names[email] = name;
  }
  return names;
}

/**
 * One roster member an admin can grant SOP access to. `hasPageAccess` is the
 * honest caveat: a personal grant is inert for someone who can't open
 * /admin/sops at all, so the picker can say so rather than letting an admin
 * grant access that quietly does nothing.
 */
export interface GrantablePerson {
  email: string;
  name: string;
  role: SopRole;
  hasPageAccess: boolean;
}

const SOPS_PAGE = '/admin/sops';

/**
 * Everyone who can be named in a SOP grant: active roster members with an
 * email, by name. Admin-only — unlike getPeopleNames, which answers only for
 * the emails a response already mentions, this *is* the address book, so it
 * must never be attached to a non-admin response.
 */
export async function listGrantablePeople(): Promise<GrantablePerson[]> {
  const rows = await listStaff();
  return (rows ?? [])
    .filter((row) => row.active && (row.email ?? '').trim())
    .map((row) => {
      const email = (row.email ?? '').trim().toLowerCase();
      const role: SopRole = row.is_admin ? 'admin' : row.is_shift_lead ? 'shift_lead' : 'staff';
      return {
        email,
        name: (row.display_name ?? '').trim() || email,
        role,
        hasPageAccess: row.is_admin || (row.pages ?? []).includes(SOPS_PAGE),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
