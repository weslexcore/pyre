// Dashboard access lookup: who may see the admin dashboard, and which pages.
// Source of truth is the dashboard_users table (managed from /admin/users);
// the ADMIN_EMAILS / STAFF_EMAILS env vars survive only as a bootstrap
// fallback while the table holds no admin row (or Supabase is unreachable),
// so a fresh deployment can never lock every admin out.

import { getDb } from '../db';

export interface DashboardUserRow {
  id: string;
  email: string;
  is_admin: boolean;
  pages: string[];
  display_name: string | null;
  momence_member_id: number | null;
  added_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DashboardAccess {
  isAdmin: boolean;
  /** Admin page hrefs this user may view; irrelevant for admins (all pages). */
  pages: string[];
  /** 'env' = bootstrap allowlist fallback, no dashboard_users row matched. */
  source: 'db' | 'env';
}

// Pages the env STAFF_EMAILS fallback maps to — the two tools that were
// staff-accessible under the old allowlist contract.
const ENV_STAFF_PAGES = ['/admin/schedule', '/admin/water'];

// The roster is tiny (a dozen rows), so cache the whole table briefly rather
// than querying per request. Mutations in /api/admin/users invalidate it.
const CACHE_TTL_MS = 30_000;
let cache: { rows: DashboardUserRow[]; at: number } | null = null;

export function invalidateAccessCache(): void {
  cache = null;
}

/** All dashboard_users rows (cached ~30s), or null when Supabase is down. */
export async function listDashboardUsers(force = false): Promise<DashboardUserRow[] | null> {
  const db = getDb();
  if (!db) return null;

  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;

  const { data, error } = await db
    .from('dashboard_users')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[access] dashboard_users fetch failed:', error.message);
    // A stale roster beats falling back to env vars mid-flight.
    return cache?.rows ?? null;
  }

  cache = { rows: data as DashboardUserRow[], at: Date.now() };
  return cache.rows;
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
 * the dashboard_users rows so legacy allowlist entries stay visible and can
 * be imported into the table.
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

  const rows = await listDashboardUsers();
  const row = rows?.find((r) => r.email === normalized);
  if (row) return { isAdmin: row.is_admin, pages: row.pages, source: 'db' };

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
