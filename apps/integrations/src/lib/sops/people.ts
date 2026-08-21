// The staff name directory the SOP responses carry, so the UI can show who
// started a run, checked an item, or edited a document by name instead of by
// email. Server-only (reads the staff table via the cached roster in
// lib/auth/access); the rendering half lives in names.ts.

import { listStaff } from '@/lib/auth/access';
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
