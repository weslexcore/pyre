// Partner registry management for /admin/partners: list, add, edit, and remove
// `partners` rows — the reciprocal-discount program's source of truth for who
// verifies membership, which Momence tag carries the discount, and the
// enable/expiry/reconciliation levers.
//
// Reads need the page grant; every mutation needs admin or the partners:manage
// capability, because each one either changes who gets emailed about a real
// customer or repoints the tag a live price rule keys on.
//
// Guards: the slug is immutable (verification history, live confirm/deny links,
// and PostHog properties all key on it), a partner can't be enabled with no
// contact addresses, and a partner with verification history is disabled rather
// than deleted so the audit trail survives.

import type { APIRoute } from 'astro';
import { PARTNERS_MANAGE } from '@/components/admin/adminTools';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import { getDb, type PartnerRow } from '@/lib/db';
import { isLiveTemplate } from '@/lib/email/dev-mode';
import { fetchTagMap, invalidateTagCache } from '@/lib/momence/host-api';
import {
  getLegacyContactEnv,
  getPartnerCcEmail,
  invalidatePartnerCache,
  listPartners,
} from '@/lib/partner/registry';

export const prerender = false;

const PAGE = '/admin/partners';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;
const MAX_CONTACTS = 10;

/**
 * camelCase in, snake_case columns out — or an error message. `partial` skips
 * required-field checks so PATCH can send only what changed.
 */
function parsePartnerColumns(
  body: Record<string, unknown>,
  partial: boolean
): Record<string, unknown> | string {
  const columns: Record<string, unknown> = {};

  if (body.name !== undefined || !partial) {
    const name = String(body.name ?? '').trim();
    if (!name) return 'Name is required';
    if (name.length > 120) return 'Name must be 120 characters or fewer';
    columns.name = name;
  }

  if (body.tagName !== undefined || !partial) {
    const tagName = String(body.tagName ?? '').trim();
    if (!tagName) return 'Momence tag name is required';
    if (tagName.length > 120) return 'Tag name must be 120 characters or fewer';
    columns.tag_name = tagName;
  }

  if (body.discountPercent !== undefined || !partial) {
    const discount = Number(body.discountPercent);
    if (!Number.isInteger(discount) || discount < 1 || discount > 99) {
      return 'Discount must be a whole number between 1 and 99';
    }
    columns.discount_percent = discount;
  }

  if (body.contactEmails !== undefined) {
    const value = body.contactEmails;
    if (!Array.isArray(value) || value.some((e) => typeof e !== 'string')) {
      return 'contactEmails must be an array of email addresses';
    }
    const emails = [
      ...new Set((value as string[]).map((e) => e.trim().toLowerCase()).filter(Boolean)),
    ];
    const invalid = emails.filter((e) => !EMAIL_RE.test(e));
    if (invalid.length > 0) return `Invalid email: ${invalid.join(', ')}`;
    if (emails.length > MAX_CONTACTS) return `At most ${MAX_CONTACTS} contact addresses`;
    columns.contact_emails = emails;
  }

  if (body.ccEmail !== undefined) {
    const cc = String(body.ccEmail ?? '')
      .trim()
      .toLowerCase();
    if (cc && !EMAIL_RE.test(cc)) return 'Invalid CC email';
    columns.cc_email = cc || null;
  }

  if (body.decisionExpiryDays !== undefined) {
    const days = Number(body.decisionExpiryDays);
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      return 'Link expiry must be a whole number of days between 1 and 90';
    }
    columns.decision_expiry_days = days;
  }

  if (body.enabled !== undefined) columns.enabled = body.enabled === true;
  if (body.reconciliationEnabled !== undefined) {
    columns.reconciliation_enabled = body.reconciliationEnabled === true;
  }

  if (body.notes !== undefined) {
    const notes = String(body.notes ?? '').trim();
    if (notes.length > 2000) return 'Notes must be 2000 characters or fewer';
    columns.notes = notes || null;
  }

  return columns;
}

/** requireAdmin OR the partners:manage capability, plus the CSRF backstop. */
async function gateMutation(
  cookies: Parameters<APIRoute>[0]['cookies'],
  request: Request
): Promise<{ email: string } | Response> {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;
  if (!gate.access.isAdmin && !gate.access.pages.includes(PARTNERS_MANAGE)) {
    return json({ error: 'Forbidden' }, 403);
  }
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  return { email: (gate.user.email ?? '').toLowerCase() };
}

async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Expected application/json' }, 415);
  }
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
}

/** Verification-row counts per slug, for the disable/delete guards and the UI. */
async function requestCounts(): Promise<
  Record<string, { pending: number; confirmed: number; total: number }>
> {
  const db = getDb();
  if (!db) return {};
  const { data } = await db.from('partner_verifications').select('partner_slug, status');
  const counts: Record<string, { pending: number; confirmed: number; total: number }> = {};
  for (const row of (data ?? []) as { partner_slug: string; status: string }[]) {
    counts[row.partner_slug] ??= { pending: 0, confirmed: 0, total: 0 };
    const entry = counts[row.partner_slug];
    entry.total += 1;
    if (row.status === 'pending') entry.pending += 1;
    if (row.status === 'confirmed') entry.confirmed += 1;
  }
  return counts;
}

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const partners = await listPartners(true);
  if (partners === null) return json({ error: 'Storage unavailable' }, 503);

  // Best-effort: a Momence outage must not 500 the page, but a tag name that
  // doesn't exist over there silently breaks every confirm, so it's worth
  // surfacing. null = we couldn't check.
  let tagStatus: Record<string, boolean | null> = {};
  try {
    const tagMap = await fetchTagMap();
    tagStatus = Object.fromEntries(
      partners.map((p) => [p.slug, tagMap[p.tag_name.toLowerCase()] !== undefined])
    );
  } catch (error) {
    console.warn(
      '[partners] Momence tag lookup failed:',
      error instanceof Error ? error.message : error
    );
    tagStatus = Object.fromEntries(partners.map((p) => [p.slug, null]));
  }

  // Legacy per-partner contact env vars still available to import.
  const legacyEnvContacts = partners
    .filter((p) => p.contact_emails.length === 0 && getLegacyContactEnv(p.slug))
    .map((p) => ({ slug: p.slug, email: getLegacyContactEnv(p.slug) as string }));

  return json({
    partners,
    legacyEnvContacts,
    ccEmailEnv: getPartnerCcEmail(),
    // Without this, partner email is suppressed to everyone off the dev
    // whitelist — the page banners it rather than letting it fail silently.
    partnerTemplatesLive: isLiveTemplate('partner-verification-request'),
    tagStatus,
    counts: await requestCounts(),
    canManage: gate.access.isAdmin || gate.access.pages.includes(PARTNERS_MANAGE),
  });
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await gateMutation(cookies, request);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const body = await readJson(request);
  if (body instanceof Response) return body;

  const slug = String(body.slug ?? '')
    .trim()
    .toLowerCase();
  if (!SLUG_RE.test(slug)) {
    return json(
      { error: 'Slug must be lowercase letters, numbers, and hyphens (e.g. "bft")' },
      400
    );
  }

  const columns = parsePartnerColumns(body, false);
  if (typeof columns === 'string') return json({ error: columns }, 400);

  // A partner with nobody to email can't verify anyone — don't let it launch
  // enabled and silently reject every request.
  const contacts = (columns.contact_emails as string[] | undefined) ?? [];
  if (columns.enabled !== false && contacts.length === 0) {
    return json({ error: 'Add at least one contact address before enabling this partner' }, 400);
  }

  const { data, error } = await db
    .from('partners')
    .insert({ ...columns, slug, created_by: gate.email, updated_by: gate.email })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') return json({ error: `Partner "${slug}" already exists` }, 409);
    return json({ error: error.message }, 500);
  }

  invalidatePartnerCache();
  // A brand-new tag won't be in the 24h-cached map yet.
  await invalidateTagCache().catch(() => {});
  return json({ partner: data as PartnerRow }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const gate = await gateMutation(cookies, request);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const body = await readJson(request);
  if (body instanceof Response) return body;

  const id = String(body.id ?? '');
  if (!id) return json({ error: 'Missing id' }, 400);

  const partners = (await listPartners(true)) ?? [];
  const row = partners.find((p) => p.id === id);
  if (!row) return json({ error: 'No such partner' }, 404);

  if (body.slug !== undefined && String(body.slug).trim().toLowerCase() !== row.slug) {
    return json(
      {
        error:
          'The slug is permanent — verification history, live confirm/deny links, and the landing page form all key on it. Create a new partner instead.',
      },
      400
    );
  }

  const columns = parsePartnerColumns(body, true);
  if (typeof columns === 'string') return json({ error: columns }, 400);
  if (Object.keys(columns).length === 0) return json({ error: 'Nothing to update' }, 400);

  const willBeEnabled = (columns.enabled as boolean | undefined) ?? row.enabled;
  const willHaveContacts = (columns.contact_emails as string[] | undefined) ?? row.contact_emails;
  // The legacy env fallback still counts as "someone gets the email".
  const hasLegacy = getLegacyContactEnv(row.slug) !== null;
  if (willBeEnabled && willHaveContacts.length === 0 && !hasLegacy) {
    return json({ error: 'Add at least one contact address, or disable this partner' }, 400);
  }

  const tagChanged =
    columns.tag_name !== undefined && (columns.tag_name as string) !== row.tag_name;

  const { data, error } = await db
    .from('partners')
    .update({ ...columns, updated_by: gate.email })
    .eq('id', id)
    .select('*')
    .single();

  if (error) return json({ error: error.message }, 500);

  invalidatePartnerCache();
  if (tagChanged) await invalidateTagCache().catch(() => {});

  const counts = await requestCounts();
  return json({
    partner: data as PartnerRow,
    // Retagging is not automatic: members already carrying the old tag keep it
    // (and its price rule). The UI warns with this count.
    ...(tagChanged && { retagWarningCount: counts[row.slug]?.confirmed ?? 0 }),
  });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const gate = await gateMutation(cookies, request);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'Missing id' }, 400);

  const partners = (await listPartners(true)) ?? [];
  const row = partners.find((p) => p.id === id);
  if (!row) return json({ error: 'No such partner' }, 404);

  // Verification rows reference the slug and must outlive the partner, so a
  // partner with history is disabled, never deleted. Deleting is only for the
  // just-added-a-typo case.
  const counts = await requestCounts();
  const used = counts[row.slug]?.total ?? 0;
  if (used > 0) {
    return json(
      {
        error: `${used} verification request${used === 1 ? '' : 's'} reference this partner — disable it instead of deleting, so the history stays readable.`,
      },
      409
    );
  }

  const { error } = await db.from('partners').delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);

  invalidatePartnerCache();
  return json({ ok: true });
};
