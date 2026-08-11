// Template-level email delivery gate. The baseline comes from env vars:
// EMAIL_LIVE_TEMPLATES is the allowlist of what delivers for real (comma-
// separated exact template keys and/or `prefix-*` globs; `*` = everything
// live), and EMAIL_DEV_WHITELIST addresses receive every template regardless.
// On top of that sit the dashboard-managed Supabase tables (see the email_gate
// migration): email_template_overrides pins a template live or gated
// regardless of the env pattern, and email_whitelist adds recipients alongside
// the env ones. Enforced at the single sendTemplate() choke point so ALL
// emails (confirmations, first-timer, cron/journeys) honor it automatically.
//
// Reads go through getEmailGate(), which snapshots both tables (cached ~30s,
// invalidated by the /api/admin/email-gate mutations) and falls back to
// env-only behavior when Supabase is unreachable — a fresh deployment or a DB
// blip can never accidentally open the gate wider than the env says.

import { type EmailTemplateOverrideRow, type EmailWhitelistRow, getDb } from '../db';

export interface WhitelistEntry {
  email: string;
  /** 'env' entries are read-only in the UI; 'db' rows are dashboard-managed. */
  source: 'env' | 'db';
}

export interface EmailGate {
  /** Effective live status: override row if present, else env pattern. */
  isLive(template: string): boolean;
  /** Whether this address receives gated templates (env ∪ db whitelist). */
  isAllowed(to: string): boolean;
  /** Per-template override rows, keyed by template. */
  overrides: Record<string, boolean>;
  /** Full effective whitelist with provenance, env entries first. */
  whitelist: WhitelistEntry[];
  /** False when Supabase was unreachable and only env config applied. */
  dbAvailable: boolean;
}

/** Env-pattern match only — ignores dashboard overrides. */
export function envIsLiveTemplate(template: string): boolean {
  // process.env fallback: vars added after the cached build only exist at runtime.
  const patterns = (import.meta.env.EMAIL_LIVE_TEMPLATES ?? process.env.EMAIL_LIVE_TEMPLATES ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const key = template.toLowerCase();
  return patterns.some((p) => (p.endsWith('*') ? key.startsWith(p.slice(0, -1)) : key === p));
}

/** Env whitelist only — ignores dashboard entries. */
export function getEnvWhitelist(): string[] {
  // process.env fallback: vars added after the cached build only exist at runtime.
  return (import.meta.env.EMAIL_DEV_WHITELIST ?? process.env.EMAIL_DEV_WHITELIST ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Both tables together hold a few dozen rows at most; cache the snapshot
// briefly rather than querying per send. Mutations invalidate it.
const CACHE_TTL_MS = 30_000;
let cache: { overrides: Record<string, boolean>; dbWhitelist: string[]; at: number } | null = null;

export function invalidateGateCache(): void {
  cache = null;
}

async function loadGateRows(): Promise<{
  overrides: Record<string, boolean>;
  dbWhitelist: string[];
} | null> {
  const db = getDb();
  if (!db) return null;

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { overrides: cache.overrides, dbWhitelist: cache.dbWhitelist };
  }

  const [overridesRes, whitelistRes] = await Promise.all([
    db.from('email_template_overrides').select('template, live'),
    db.from('email_whitelist').select('email'),
  ]);
  if (overridesRes.error || whitelistRes.error) {
    const message = overridesRes.error?.message ?? whitelistRes.error?.message;
    console.error('[Email] gate fetch failed:', message);
    // A stale snapshot beats silently reverting to env-only mid-flight.
    return cache ? { overrides: cache.overrides, dbWhitelist: cache.dbWhitelist } : null;
  }

  const overrides = Object.fromEntries(
    (overridesRes.data as Pick<EmailTemplateOverrideRow, 'template' | 'live'>[]).map((r) => [
      r.template,
      r.live,
    ])
  );
  const dbWhitelist = (whitelistRes.data as Pick<EmailWhitelistRow, 'email'>[]).map((r) => r.email);
  cache = { overrides, dbWhitelist, at: Date.now() };
  return { overrides, dbWhitelist };
}

/** Snapshot of the effective delivery gate (env baseline + DB overrides). */
export async function getEmailGate(): Promise<EmailGate> {
  const rows = await loadGateRows();
  const overrides = rows?.overrides ?? {};
  const dbWhitelist = rows?.dbWhitelist ?? [];

  const envEntries = getEnvWhitelist();
  const envSet = new Set(envEntries);
  const whitelist: WhitelistEntry[] = [
    ...envEntries.map((email) => ({ email, source: 'env' as const })),
    ...dbWhitelist
      .filter((email) => !envSet.has(email))
      .map((email) => ({ email, source: 'db' as const })),
  ];
  const allowedSet = new Set(whitelist.map((e) => e.email));

  return {
    isLive: (template) => overrides[template.toLowerCase()] ?? envIsLiveTemplate(template),
    isAllowed: (to) => allowedSet.has(to.toLowerCase()),
    overrides,
    whitelist,
    dbAvailable: rows !== null,
  };
}

/** Pin a template live/gated (live = boolean) or return it to env control (null). */
export async function setTemplateOverride(
  template: string,
  live: boolean | null,
  updatedBy: string | null
): Promise<{ error: string | null }> {
  const db = getDb();
  if (!db) return { error: 'Storage unavailable' };

  const key = template.toLowerCase();
  const { error } =
    live === null
      ? await db.from('email_template_overrides').delete().eq('template', key)
      : await db
          .from('email_template_overrides')
          .upsert({ template: key, live, updated_by: updatedBy }, { onConflict: 'template' });
  if (error) return { error: error.message };
  invalidateGateCache();
  return { error: null };
}

export async function addWhitelistEmail(
  email: string,
  addedBy: string | null
): Promise<{ error: string | null }> {
  const db = getDb();
  if (!db) return { error: 'Storage unavailable' };

  const { error } = await db
    .from('email_whitelist')
    .upsert({ email: email.toLowerCase(), added_by: addedBy }, { onConflict: 'email' });
  if (error) return { error: error.message };
  invalidateGateCache();
  return { error: null };
}

export async function removeWhitelistEmail(email: string): Promise<{ error: string | null }> {
  const db = getDb();
  if (!db) return { error: 'Storage unavailable' };

  const { error } = await db.from('email_whitelist').delete().eq('email', email.toLowerCase());
  if (error) return { error: error.message };
  invalidateGateCache();
  return { error: null };
}
