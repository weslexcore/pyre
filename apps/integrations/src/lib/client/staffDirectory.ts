// The staff directory on the client: who each email is and what their
// avatar looks like. AdminLayout writes it into every admin page as inert
// JSON, so any island can draw anyone's badge from an email alone, with no
// fetch. Each client-side navigation swaps in a fresh copy, which is read
// again on `astro:after-swap`.
//
// Changing your own photo or colour on /admin/account patches the entry
// here at once (`patchStaffEntry`), so every badge on the page updates
// without a reload. The next page the server renders carries the change.

import { useSyncExternalStore } from 'react';
import { STAFF_DIRECTORY_ELEMENT_ID, type StaffDirectoryEntry } from '@/lib/staff/avatar';

type Directory = ReadonlyMap<string, StaffDirectoryEntry>;

const EMPTY: Directory = new Map();

let directory: Directory | null = null;
/** Patches made on this page that a fresh server copy may not carry yet. */
const patches = new Map<string, Partial<StaffDirectoryEntry>>();
const listeners = new Set<() => void>();

function readDirectory(): Directory {
  if (typeof document === 'undefined') return EMPTY;
  const element = document.getElementById(STAFF_DIRECTORY_ELEMENT_ID);
  const map = new Map<string, StaffDirectoryEntry>();
  if (element?.textContent) {
    try {
      const entries = JSON.parse(element.textContent) as StaffDirectoryEntry[];
      for (const entry of entries) map.set(entry.email, entry);
    } catch {
      // A broken directory only costs the photos; badges fall back to initials.
    }
  }
  for (const [email, patch] of patches) {
    const entry = map.get(email);
    if (entry) map.set(email, { ...entry, ...patch });
  }
  return map;
}

function current(): Directory {
  directory ??= readDirectory();
  return directory;
}

function notify(): void {
  for (const listener of listeners) listener();
}

if (typeof document !== 'undefined') {
  document.addEventListener('astro:after-swap', () => {
    directory = null;
    notify();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The directory entry for an email, or undefined for someone not on it. */
export function useStaffEntry(email: string | null | undefined): StaffDirectoryEntry | undefined {
  const map = useSyncExternalStore(subscribe, current, () => EMPTY);
  return email ? map.get(email.trim().toLowerCase()) : undefined;
}

/** Update one person's entry on this page (after they change their own avatar). */
export function patchStaffEntry(email: string, patch: Partial<StaffDirectoryEntry>): void {
  const key = email.trim().toLowerCase();
  patches.set(key, { ...patches.get(key), ...patch });
  directory = null;
  notify();
}
