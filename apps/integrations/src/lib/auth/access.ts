// Dashboard access lookup: who may see the admin dashboard, and which pages.
// Source of truth is the `staff` table (one row per person — dashboard access
// and the scheduling roster in one place, managed from /admin/users); the
// ADMIN_EMAILS / STAFF_EMAILS env vars survive only as a bootstrap fallback
// while the table holds no admin row (or Supabase is unreachable), so a fresh
// deployment can never lock every admin out.

import { SHIFT_NOTES_HREF } from '@/components/admin/adminTools';
import { getDb, type StaffRow } from '../db';

export interface DashboardAccess {
  isAdmin: boolean;
  /** Admin page hrefs this user may view; irrelevant for admins (all pages). */
  pages: string[];
  /** 'env' = bootstrap allowlist fallback, no staff row matched. */
  source: 'db' | 'env';
}

// Pages the env STAFF_EMAILS fallback maps to — the two tools that were
// staff-accessible under the old allowlist contract.
const ENV_STAFF_PAGES = ['/admin/schedule', '/admin/water'];

// The roster is tiny (a dozen rows), so cache the whole table briefly rather
// than querying per request. Mutations in /api/admin/users invalidate it.
const CACHE_TTL_MS = 30_000;
let cache: { rows: StaffRow[]; at: number } | null = null;

export function invalidateAccessCache(): void {
  cache = null;
}

/** All staff rows (cached ~30s), or null when Supabase is down. */
export async function listStaff(force = false): Promise<StaffRow[] | null> {
  const db = getDb();
  if (!db) return null;

  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;

  const { data, error } = await db.from('staff').select('*').order('display_name');

  if (error) {
    console.error('[access] staff fetch failed:', error.message);
    // A stale roster beats falling back to env vars mid-flight.
    return cache?.rows ?? null;
  }

  cache = { rows: data as StaffRow[], at: Date.now() };
  return cache.rows;
}

/** Whether this row grants any dashboard access at all (vs roster-only). */
export function hasDashboardAccess(row: StaffRow): boolean {
  return row.is_admin || row.pages.length > 0;
}

function envList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export interface EnvAllowlistEntry {
  email: string;
  isAdmin: boolean;
  pages: string[];
}

/**
 * Everyone named by the ADMIN_EMAILS / STAFF_EMAILS env vars, with the access
 * the bootstrap fallback would give them. /admin/users lists these alongside
 * the staff rows so legacy allowlist entries stay visible and can be imported.
 */
export function getEnvAllowlist(): EnvAllowlistEntry[] {
  const admins = envList(import.meta.env.ADMIN_EMAILS);
  const adminSet = new Set(admins);
  return [
    ...admins.map((email) => ({ email, isAdmin: true, pages: [] as string[] })),
    ...envList(import.meta.env.STAFF_EMAILS)
      .filter((email) => !adminSet.has(email))
      .map((email) => ({ email, isAdmin: false, pages: ENV_STAFF_PAGES })),
  ];
}

/** Resolve what `email` may do on the dashboard; null = no access at all. */
export async function getAccess(email: string): Promise<DashboardAccess | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  const rows = await listStaff();
  const row = rows?.find((r) => r.email === normalized);
  // A row without access is a roster-only person (scheduled, but no dashboard)
  // — they fall through to the same env check as anyone unknown. Shift notes
  // are the exception: writing up the shift you just worked is something
  // everyone on the roster does, so an active staff row implies that page
  // (and with it, dashboard access) without an admin ticking the checkbox on
  // /admin/users. The page still splits by role — admins read the whole log,
  // everyone else only the notes they wrote (see lib/shift-notes/access).
  // Inactive rows are people who have left: no implicit grant, so their
  // access ends with the job.
  if (row && (hasDashboardAccess(row) || row.active)) {
    const pages =
      row.active && !row.pages.includes(SHIFT_NOTES_HREF)
        ? [...row.pages, SHIFT_NOTES_HREF]
        : row.pages;
    return { isAdmin: row.is_admin, pages, source: 'db' };
  }

  // Env fallback applies only while no admin row exists (bootstrap phase, or
  // Supabase unreachable). Once an admin is in the table, it is authoritative
  // — dashboard revocations must actually revoke.
  const hasDbAdmin = rows?.some((r) => r.is_admin) ?? false;
  if (!hasDbAdmin) {
    if (envList(import.meta.env.ADMIN_EMAILS).includes(normalized)) {
      return { isAdmin: true, pages: [], source: 'env' };
    }
    if (envList(import.meta.env.STAFF_EMAILS).includes(normalized)) {
      return { isAdmin: false, pages: ENV_STAFF_PAGES, source: 'env' };
    }
  }

  return null;
}
