// Reciprocal-discount partner registry. Source of truth is the `partners`
// table (managed from /admin/partners), which replaced the hardcoded PARTNERS
// map this module used to export. The per-partner contact env vars survive
// only as a bootstrap fallback for rows whose contact_emails is still empty,
// so the program kept working the moment the table landed — same shape as the
// ADMIN_EMAILS fallback in lib/auth/access.ts.
//
// Adding a partner is now: create the Momence tag + tag-keyed price rule, then
// add the row on /admin/partners. No deploy.

import { getDb, type PartnerRow } from '@/lib/db';

// The registry is tiny (single-digit rows), so cache the whole table briefly
// rather than querying per request. Mutations in /api/admin/partners
// invalidate it. Note this only clears the lambda instance that handled the
// mutation — other warm instances serve stale rows for up to CACHE_TTL_MS,
// exactly as invalidateAccessCache behaves.
const CACHE_TTL_MS = 30_000;
let cache: { rows: PartnerRow[]; at: number } | null = null;

export function invalidatePartnerCache(): void {
  cache = null;
}

/** All partner rows (cached ~30s), or null when Supabase is down. */
export async function listPartners(force = false): Promise<PartnerRow[] | null> {
  const db = getDb();
  if (!db) return null;

  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;

  const { data, error } = await db.from('partners').select('*').order('name');

  if (error) {
    console.error('[partners] registry fetch failed:', error.message);
    // A stale registry beats treating a query error as "no partners" — that
    // would silently reject every verification request.
    return cache?.rows ?? null;
  }

  cache = { rows: data as PartnerRow[], at: Date.now() };
  return cache.rows;
}

/**
 * The partner behind `slug`, enabled or not. Decisions on already-issued
 * confirm/deny links must still resolve a disabled partner — disabling stops
 * new requests, it doesn't break links already sitting in someone's inbox.
 */
export async function getPartner(slug: string): Promise<PartnerRow | null> {
  const rows = await listPartners();
  return rows?.find((p) => p.slug === slug) ?? null;
}

export type PartnerLookup =
  | { status: 'found'; partner: PartnerRow }
  | { status: 'disabled'; partner: PartnerRow }
  | { status: 'unknown' }
  | { status: 'unavailable' };

/**
 * Intake-path lookup. Keeps "no such partner" (a caller bug, 400) distinct
 * from "storage is down" (503) — /api/partner/request keys its status code on
 * the difference, so collapsing both into null would make an outage look like
 * a bad request.
 */
export async function lookupPartner(slug: string): Promise<PartnerLookup> {
  const rows = await listPartners();
  if (rows === null) return { status: 'unavailable' };
  const partner = rows.find((p) => p.slug === slug);
  if (!partner) return { status: 'unknown' };
  return partner.enabled ? { status: 'found', partner } : { status: 'disabled', partner };
}

// Legacy bootstrap only: the per-partner contact env vars from before the
// table existed. Delete an entry once its partner row has contact_emails (the
// admin page offers a one-click import). Static keys are required —
// import.meta.env is inlined by Vite at build time and can't be indexed
// dynamically. process.env fallback because env vars added to Vercel after a
// cached build only exist at runtime.
const LEGACY_CONTACT_ENV: Record<string, string | undefined> = {
  bft: import.meta.env.PARTNER_BFT_CONTACT_EMAIL ?? process.env.PARTNER_BFT_CONTACT_EMAIL,
};

/** Whether `slug` still has a legacy env contact available to import. */
export function getLegacyContactEnv(slug: string): string | null {
  return LEGACY_CONTACT_ENV[slug]?.trim().toLowerCase() || null;
}

/**
 * Who receives this partner's confirm/deny and reconciliation email: the row's
 * addresses, else the legacy env fallback, else nobody (requests rejected).
 */
export function getPartnerContacts(partner: PartnerRow): string[] {
  if (partner.contact_emails.length > 0) return partner.contact_emails;
  const legacy = getLegacyContactEnv(partner.slug);
  return legacy ? [legacy] : [];
}

/** Pyre staff address CC'd on all partner-facing email (visibility, replies). */
export function getPartnerCcEmail(): string | null {
  return import.meta.env.PARTNER_CC_EMAIL ?? process.env.PARTNER_CC_EMAIL ?? null;
}

/** The partner's CC override, falling back to the global staff address. */
export function getPartnerCc(partner: PartnerRow): string | null {
  return partner.cc_email ?? getPartnerCcEmail();
}
