import { createWebhookLogger } from '@pyre/webhook-core';
import { captureEvent } from '@/lib/analytics/posthog';
import type { CronJobContext } from '@/lib/cron/jobs';
import { getDb, type PartnerRow, type PartnerVerificationRow } from '@/lib/db';
import { type SendResult, sendTemplate } from '@/lib/email/send';
import {
  assignMemberTag,
  createMember,
  fetchMembersFiltered,
  findMemberByEmail,
  getTagIdByName,
  updateMemberPhoneNumber,
} from '@/lib/momence/host-api';
import { createDecisionToken, type DecisionAction } from './decision-token';
import {
  getPartner,
  getPartnerCc,
  getPartnerContacts,
  listPartners,
  lookupPartner,
} from './registry';

const log = createWebhookLogger('Partner Verification');

// The one-click partner confirmation flow behind the reciprocal-discount
// program. State machine per request row: pending -> confirmed | denied |
// expired. Momence owns the discount itself (tag + price rule); this module
// owns getting the tag onto the right member with the partner's sign-off.

const TABLE = 'partner_verifications';

/**
 * Fallback link/row lifetime for a slug with no partner row left (mirrors the
 * partners.decision_expiry_days column default). Live partners carry their
 * own value — the expiry is baked into the signed token at send time, so
 * changing a partner's setting never re-expires or extends links already sent.
 */
export const DEFAULT_DECISION_EXPIRY_DAYS = 14;

const RECONCILIATION_PAGE_SIZE = 100;

function decisionUrl(requestId: string, action: DecisionAction, expiryDays: number): string | null {
  const token = createDecisionToken(requestId, action, expiryDays);
  if (!token) return null;
  // Same origin convention as buildUnsubscribeUrl: PUBLIC_EMAIL_ASSET_BASE may
  // carry a path — only its origin is this app's deployment.
  const origin = import.meta.env.PUBLIC_EMAIL_ASSET_BASE
    ? new URL(import.meta.env.PUBLIC_EMAIL_ASSET_BASE).origin
    : 'https://pyre-integrations.vercel.app';
  return `${origin}/api/partner/decision?token=${token}`;
}

function bookUrl(partner: PartnerRow): string {
  const site =
    import.meta.env.PUBLIC_SITE_URL ?? process.env.PUBLIC_SITE_URL ?? 'https://pyresauna.com';
  return `${site}/events?utm_source=${partner.slug}&utm_medium=partner&utm_campaign=${partner.slug}-verified`;
}

export interface ContactSendOutcome {
  email: string;
  status: SendResult['status'] | 'failed';
  reason?: string;
}

/**
 * Email every partner contact the same signed confirm/deny links. One send per
 * address rather than one message with several To: recipients — sendTemplate is
 * single-recipient end to end (dev whitelist, suppression, the email_sends
 * audit row, send_key), and per-recipient rows mean the email dashboard shows
 * exactly which contact bounced instead of one opaque failure.
 *
 * First click wins regardless of how many copies go out: the token is keyed on
 * request id + action, not recipient, and the conditional status update in
 * applyDecision is the real guard.
 */
async function emailPartnerContacts(params: {
  partner: PartnerRow;
  contacts: string[];
  requestId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  partnerMemberEmail: string | null;
  expiryDays: number;
}): Promise<ContactSendOutcome[]> {
  const { partner, contacts, expiryDays } = params;
  const confirmUrl = decisionUrl(params.requestId, 'confirm', expiryDays);
  const denyUrl = decisionUrl(params.requestId, 'deny', expiryDays);
  if (!confirmUrl || !denyUrl) throw new LinkSecretMissingError();

  const cc = getPartnerCc(partner) ?? undefined;
  const results: ContactSendOutcome[] = [];

  for (const email of contacts) {
    try {
      const result = await sendTemplate({
        to: email,
        cc,
        template: 'partner-verification-request',
        props: {
          partnerName: partner.name,
          customerName: params.customerName,
          customerEmail: params.customerEmail,
          customerPhone: params.customerPhone,
          partnerMemberEmail: params.partnerMemberEmail,
          confirmUrl,
          denyUrl,
          expiresDays: expiryDays,
          // Lets the template explain why a colleague may have gotten this
          // too — recipients can't see each other on the To: line.
          otherRecipientCount: contacts.length - 1,
        },
      });
      results.push({
        email,
        status: result.status,
        ...(result.status !== 'sent' && { reason: result.reason }),
      });
    } catch (error) {
      // One bad address must not cost the others their copy.
      log.warn(`Partner contact send failed for ${email}`, error);
      results.push({
        email,
        status: 'failed',
        reason: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return results;
}

/** Thrown when PARTNER_LINK_SECRET/CRON_SECRET is unset, so no link can be signed. */
class LinkSecretMissingError extends Error {
  constructor() {
    super('Partner link secret not configured');
    this.name = 'LinkSecretMissingError';
  }
}

export type CreateRequestResult =
  | { outcome: 'created' }
  | { outcome: 'duplicate'; status: PartnerVerificationRow['status'] }
  | { outcome: 'unavailable'; reason: string };

export async function createVerificationRequest(params: {
  partnerSlug: string;
  customerFirstName: string;
  customerLastName: string;
  customerEmail: string;
  customerPhone?: string;
  partnerMemberEmail?: string;
}): Promise<CreateRequestResult> {
  const lookup = await lookupPartner(params.partnerSlug);
  if (lookup.status === 'unavailable') {
    return { outcome: 'unavailable', reason: 'storage-unavailable' };
  }
  if (lookup.status === 'unknown') return { outcome: 'unavailable', reason: 'unknown-partner' };
  if (lookup.status === 'disabled') return { outcome: 'unavailable', reason: 'partner-disabled' };

  const partner = lookup.partner;
  const contacts = getPartnerContacts(partner);
  if (contacts.length === 0) {
    return { outcome: 'unavailable', reason: 'partner-not-configured' };
  }

  const db = getDb();
  if (!db) return { outcome: 'unavailable', reason: 'db-not-configured' };

  const customerEmail = params.customerEmail.trim().toLowerCase();
  const partnerMemberEmail = params.partnerMemberEmail?.trim().toLowerCase() || null;

  // An open or already-approved request never re-emails the partner — repeat
  // submissions can't be used to spam the contact address.
  const { data: existing } = await db
    .from(TABLE)
    .select('id, status')
    .eq('partner_slug', partner.slug)
    .eq('customer_email', customerEmail)
    .in('status', ['pending', 'confirmed'])
    .limit(1);
  if (existing && existing.length > 0) {
    return { outcome: 'duplicate', status: existing[0].status };
  }

  const { data: inserted, error } = await db
    .from(TABLE)
    .insert({
      partner_slug: partner.slug,
      customer_first_name: params.customerFirstName.trim(),
      customer_last_name: params.customerLastName.trim(),
      customer_email: customerEmail,
      partner_member_email: partnerMemberEmail,
      customer_phone: params.customerPhone?.trim() || null,
    })
    .select('id')
    .single();
  if (error || !inserted) {
    // Unique-index race with a concurrent submission counts as a duplicate.
    if (error?.code === '23505') return { outcome: 'duplicate', status: 'pending' };
    log.error('Failed to insert verification request', error);
    return { outcome: 'unavailable', reason: 'db-insert-failed' };
  }

  const expiryDays = partner.decision_expiry_days;

  let results: ContactSendOutcome[];
  try {
    results = await emailPartnerContacts({
      partner,
      contacts,
      requestId: inserted.id,
      customerName: `${params.customerFirstName.trim()} ${params.customerLastName.trim()}`,
      customerEmail,
      customerPhone: params.customerPhone?.trim() || null,
      partnerMemberEmail,
      expiryDays,
    });
  } catch (error) {
    await db.from(TABLE).delete().eq('id', inserted.id);
    if (error instanceof LinkSecretMissingError) {
      return { outcome: 'unavailable', reason: 'link-secret-not-configured' };
    }
    throw error;
  }

  // Only a real delivery counts — 'suppressed' (the EMAIL_LIVE_TEMPLATES gate)
  // and 'skipped' mean nobody was told. If not one contact was reached, drop
  // the row so the customer's retry isn't swallowed by the dedupe check above;
  // otherwise keep it and record the shortfall for the admin queue to badge.
  const notified = results.filter((r) => r.status === 'sent').length;
  if (notified === 0) {
    await db.from(TABLE).delete().eq('id', inserted.id);
    log.error(
      `No partner contact reached for ${partner.slug}/${customerEmail}`,
      results.map((r) => `${r.email}:${r.status}${r.reason ? `(${r.reason})` : ''}`).join(', ')
    );
    return { outcome: 'unavailable', reason: 'partner-email-failed' };
  }

  await db
    .from(TABLE)
    .update({ notified_count: notified, last_notified_at: new Date().toISOString() })
    .eq('id', inserted.id);

  await captureEvent({
    distinctId: customerEmail,
    event: 'partner_verification_submitted',
    properties: {
      partner: partner.slug,
      notified_count: notified,
      contact_count: contacts.length,
    },
  });

  return { outcome: 'created' };
}

export type DecisionResult =
  | { outcome: 'confirmed' }
  | { outcome: 'denied' }
  | { outcome: 'already-handled'; status: PartnerVerificationRow['status'] }
  | { outcome: 'not-found' }
  /** The request's partner_slug no longer has a row — we can't know its tag. */
  | { outcome: 'partner-missing' };

/**
 * Who is acting. The signed token only ever carries 'confirm' or 'deny', so a
 * partner link can never present itself as an admin — the default is the
 * original one-click path and /api/partner/decision passes nothing.
 */
export type DecisionActor =
  | { kind: 'partner-link' }
  | { kind: 'admin'; email: string }
  | { kind: 'cron' };

/** What lands in partner_verifications.decided_by. */
function actorTag(actor: DecisionActor): string | null {
  if (actor.kind === 'admin') return actor.email;
  if (actor.kind === 'cron') return 'cron';
  return null;
}

export async function applyDecision(
  requestId: string,
  action: DecisionAction,
  actor: DecisionActor = { kind: 'partner-link' }
): Promise<DecisionResult> {
  const db = getDb();
  if (!db) throw new Error('Supabase not configured');
  const decidedBy = actorTag(actor);

  const { data: row } = await db
    .from(TABLE)
    .select('*')
    .eq('id', requestId)
    .maybeSingle<PartnerVerificationRow>();
  if (!row) return { outcome: 'not-found' };
  if (row.status !== 'pending') return { outcome: 'already-handled', status: row.status };

  // getPartner, not lookupPartner: a disabled partner's already-issued links
  // must still resolve. Disabling stops new requests, it doesn't strand
  // confirm/deny links already sitting in someone's inbox.
  const partner = await getPartner(row.partner_slug);
  if (!partner) return { outcome: 'partner-missing' };

  if (action === 'confirm') {
    // Momence work happens BEFORE the status flip: if tagging fails the row
    // stays pending and the same link retries cleanly.
    const tagId = await getTagIdByName(partner.tag_name);
    if (tagId === null) {
      throw new Error(
        `Momence tag "${partner.tag_name}" not found — create it in the dashboard first`
      );
    }

    let memberId: number;
    let memberCreated = false;
    const existing = await findMemberByEmail(row.customer_email);
    if (existing) {
      memberId = existing.id;
      // Complete the profile, never clobber it: only fill a missing phone.
      if (row.customer_phone && !existing.phoneNumber) {
        try {
          await updateMemberPhoneNumber(memberId, row.customer_phone);
        } catch (error) {
          log.warn(`Phone backfill failed for member ${memberId}`, error);
        }
      }
    } else {
      memberId = await createMember({
        email: row.customer_email,
        firstName: row.customer_first_name,
        lastName: row.customer_last_name,
        ...(row.customer_phone && { phoneNumber: row.customer_phone }),
      });
      memberCreated = true;
    }
    await assignMemberTag(memberId, tagId);

    const { data: updated } = await db
      .from(TABLE)
      .update({
        status: 'confirmed',
        momence_member_id: memberId,
        decided_at: new Date().toISOString(),
        decided_by: decidedBy,
      })
      .eq('id', requestId)
      .eq('status', 'pending')
      .select('id');
    // Lost a race with another click — the tag assignment above is idempotent.
    if (!updated || updated.length === 0) {
      return { outcome: 'already-handled', status: 'confirmed' };
    }

    await sendTemplate({
      to: row.customer_email,
      template: 'partner-verified',
      props: {
        firstName: row.customer_first_name,
        partnerName: partner.name,
        discountPercent: partner.discount_percent,
        bookUrl: bookUrl(partner),
      },
    });

    await captureEvent({
      distinctId: row.customer_email,
      event: 'partner_verification_confirmed',
      properties: {
        partner: partner.slug,
        momence_member_id: memberId,
        member_created: memberCreated,
        actor: actor.kind,
      },
    });

    return { outcome: 'confirmed' };
  }

  const { data: updated } = await db
    .from(TABLE)
    .update({ status: 'denied', decided_at: new Date().toISOString(), decided_by: decidedBy })
    .eq('id', requestId)
    .eq('status', 'pending')
    .select('id');
  if (!updated || updated.length === 0) {
    return { outcome: 'already-handled', status: 'denied' };
  }

  await sendTemplate({
    to: row.customer_email,
    template: 'partner-denied',
    props: {
      firstName: row.customer_first_name,
      partnerName: partner.name,
      reason: 'denied',
    },
  });

  await captureEvent({
    distinctId: row.customer_email,
    event: 'partner_verification_denied',
    properties: { partner: partner.slug, actor: actor.kind },
  });

  return { outcome: 'denied' };
}

/** Re-sends are throttled this long so a double-click can't spam the partner. */
const RESEND_THROTTLE_MS = 5 * 60 * 1000;

export type ResendResult =
  | { outcome: 'sent'; results: ContactSendOutcome[] }
  | { outcome: 'not-found' }
  | { outcome: 'not-pending'; status: PartnerVerificationRow['status'] }
  | { outcome: 'partner-missing' }
  | { outcome: 'no-contacts' }
  | { outcome: 'throttled'; retryAfterSeconds: number }
  | { outcome: 'send-failed'; results: ContactSendOutcome[] };

/**
 * Re-email a pending request's partner contacts — for when the original went
 * to the wrong address, got lost, or a contact was added after the fact.
 *
 * The new links carry the row's REMAINING lifetime, not a fresh full window,
 * and created_at is left alone: extending it would silently push out the
 * expiry sweep, letting a request outlive the deadline the customer was told.
 */
export async function resendVerificationRequest(
  requestId: string,
  actor: DecisionActor
): Promise<ResendResult> {
  const db = getDb();
  if (!db) throw new Error('Supabase not configured');

  const { data: row } = await db
    .from(TABLE)
    .select('*')
    .eq('id', requestId)
    .maybeSingle<PartnerVerificationRow>();
  if (!row) return { outcome: 'not-found' };
  if (row.status !== 'pending') return { outcome: 'not-pending', status: row.status };

  if (row.last_notified_at) {
    const elapsed = Date.now() - new Date(row.last_notified_at).getTime();
    if (elapsed < RESEND_THROTTLE_MS) {
      return {
        outcome: 'throttled',
        retryAfterSeconds: Math.ceil((RESEND_THROTTLE_MS - elapsed) / 1000),
      };
    }
  }

  const partner = await getPartner(row.partner_slug);
  if (!partner) return { outcome: 'partner-missing' };
  const contacts = getPartnerContacts(partner);
  if (contacts.length === 0) return { outcome: 'no-contacts' };

  // Whatever is left of the original window, never less than a day — the link
  // and the row must not disagree about when this dies.
  const ageDays = (Date.now() - new Date(row.created_at).getTime()) / (24 * 60 * 60 * 1000);
  const expiryDays = Math.max(1, Math.ceil(partner.decision_expiry_days - ageDays));

  const results = await emailPartnerContacts({
    partner,
    contacts,
    requestId: row.id,
    customerName: `${row.customer_first_name} ${row.customer_last_name}`.trim(),
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    partnerMemberEmail: row.partner_member_email,
    expiryDays,
  });

  const notified = results.filter((r) => r.status === 'sent').length;
  if (notified === 0) return { outcome: 'send-failed', results };

  await db
    .from(TABLE)
    .update({ notified_count: notified, last_notified_at: new Date().toISOString() })
    .eq('id', row.id);

  await captureEvent({
    distinctId: row.customer_email,
    event: 'partner_verification_resent',
    properties: { partner: partner.slug, notified_count: notified, actor: actor.kind },
  });

  return { outcome: 'sent', results };
}

// --- Cron: expiry sweep + quarterly reconciliation ---

function quarterBucket(now: Date): string {
  return `${now.getUTCFullYear()}-q${Math.floor(now.getUTCMonth() / 3) + 1}`;
}

async function expirePendingRequests(
  ctx: CronJobContext
): Promise<{ expired: number; wouldExpire: string[] }> {
  const db = getDb();
  if (!db) return { expired: 0, wouldExpire: [] };

  const partners = (await listPartners()) ?? [];
  const bySlug = new Map(partners.map((p) => [p.slug, p]));

  // Expiry is per-partner now, so query at the SHORTEST horizon in the
  // registry — that set is a superset of every partner's expired rows — then
  // filter each row against its own partner's value below. Querying at the
  // longest horizon instead would silently skip rows already past a
  // short-window partner's deadline.
  const shortestDays = Math.min(
    DEFAULT_DECISION_EXPIRY_DAYS,
    ...partners.map((p) => p.decision_expiry_days)
  );
  const cutoff = new Date(Date.now() - shortestDays * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await db
    .from(TABLE)
    .select('*')
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    // Oldest first: with a per-row filter behind a limit, unordered batching
    // could starve the very rows this sweep exists to clear.
    .order('created_at', { ascending: true })
    .limit(50);
  const candidates = (data ?? []) as PartnerVerificationRow[];

  const now = Date.now();
  const rows = candidates.filter((row) => {
    const days = bySlug.get(row.partner_slug)?.decision_expiry_days ?? DEFAULT_DECISION_EXPIRY_DAYS;
    return now - new Date(row.created_at).getTime() >= days * 24 * 60 * 60 * 1000;
  });
  if (rows.length === 0) return { expired: 0, wouldExpire: [] };

  if (ctx.dryRun) {
    return { expired: 0, wouldExpire: rows.map((r) => `${r.partner_slug}:${r.customer_email}`) };
  }

  let expired = 0;
  for (const row of rows) {
    const partner = bySlug.get(row.partner_slug);
    const { data: updated } = await db
      .from(TABLE)
      .update({ status: 'expired', decided_at: new Date().toISOString(), decided_by: 'cron' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id');
    if (!updated || updated.length === 0) continue;
    expired += 1;

    try {
      await sendTemplate({
        to: row.customer_email,
        template: 'partner-denied',
        props: {
          firstName: row.customer_first_name,
          partnerName: partner?.name ?? row.partner_slug,
          reason: 'expired',
        },
      });
    } catch (error) {
      log.warn(`Expiry email failed for ${row.customer_email}`, error);
    }

    await captureEvent({
      distinctId: row.customer_email,
      event: 'partner_verification_expired',
      properties: { partner: row.partner_slug },
    });
  }

  return { expired, wouldExpire: [] };
}

async function runReconciliation(
  ctx: CronJobContext
): Promise<{ sent: string[]; skipped: string[] }> {
  const sent: string[] = [];
  const skipped: string[] = [];
  const quarter = quarterBucket(new Date());

  const registry = await listPartners();
  if (registry === null) {
    // Never read a storage outage as "no partners" — log it so a silently
    // missed quarter is diagnosable rather than invisible.
    log.error('Reconciliation skipped: partner registry unavailable');
    return { sent, skipped: ['registry-unavailable'] };
  }

  for (const partner of registry) {
    if (!partner.enabled || !partner.reconciliation_enabled) {
      skipped.push(`${partner.slug}:reconciliation-off`);
      continue;
    }
    const contacts = getPartnerContacts(partner);
    if (contacts.length === 0) {
      skipped.push(`${partner.slug}:no-contact`);
      continue;
    }
    const tagId = await getTagIdByName(partner.tag_name);
    if (tagId === null) {
      skipped.push(`${partner.slug}:tag-missing`);
      continue;
    }

    const members: { name: string; email: string }[] = [];
    let page = 0;
    for (;;) {
      const { members: batch } = await fetchMembersFiltered({
        page,
        pageSize: RECONCILIATION_PAGE_SIZE,
        filter: {
          type: 'and',
          customerTags: { type: 'or', tags: [tagId], customerHaveTag: 'have' },
        },
      });
      members.push(
        ...batch.map((m) => ({ name: `${m.firstName} ${m.lastName}`.trim(), email: m.email }))
      );
      if (batch.length < RECONCILIATION_PAGE_SIZE) break;
      page += 1;
    }

    if (members.length === 0) {
      skipped.push(`${partner.slug}:no-tagged-members`);
      continue;
    }

    if (ctx.dryRun) {
      sent.push(
        `partner-reconciliation:${partner.slug}:${quarter} (${members.length} members, ${contacts.length} contacts, dry run)`
      );
      continue;
    }

    // The send_key MUST include the recipient. It is claimed before sending,
    // so a key of just slug+quarter would let the first contact claim the
    // quarter and leave every other contact silently skipped as already-sent,
    // forever, with no error anywhere.
    const cc = getPartnerCc(partner) ?? undefined;
    let delivered = 0;
    for (const email of contacts) {
      const sendKey = `partner-reconciliation:${partner.slug}:${quarter}:${email}`;
      try {
        const result = await sendTemplate({
          to: email,
          cc,
          template: 'partner-reconciliation',
          props: { partnerName: partner.name, quarterLabel: quarter, members },
          sendKey,
        });
        if (result.status === 'sent') {
          delivered += 1;
          sent.push(`${sendKey} (${members.length} members)`);
        }
      } catch (error) {
        log.warn(`Reconciliation send failed for ${email}`, error);
        skipped.push(`${partner.slug}:send-failed:${email}`);
      }
    }

    if (delivered > 0) {
      await captureEvent({
        distinctId: contacts[0],
        event: 'partner_reconciliation_sent',
        properties: {
          partner: partner.slug,
          member_count: members.length,
          notified_count: delivered,
        },
      });
    }
  }

  return { sent, skipped };
}

export async function runPartnerMaintenance(ctx: CronJobContext): Promise<Record<string, unknown>> {
  const expiry = await expirePendingRequests(ctx);
  const reconciliation = await runReconciliation(ctx);
  return {
    expired: expiry.expired,
    reconciliationSent: reconciliation.sent,
    reconciliationSkipped: reconciliation.skipped,
    ...(ctx.dryRun && { wouldExpire: expiry.wouldExpire }),
  };
}
