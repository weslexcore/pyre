import { createWebhookLogger } from '@pyre/webhook-core';
import { captureEvent } from '@/lib/analytics/posthog';
import type { CronJobContext } from '@/lib/cron/jobs';
import { getDb, type PartnerVerificationRow } from '@/lib/db';
import { sendTemplate } from '@/lib/email/send';
import {
  assignMemberTag,
  createMember,
  fetchMembersFiltered,
  findMemberByEmail,
  getTagIdByName,
  updateMemberPhoneNumber,
} from '@/lib/momence/host-api';
import { getPartner, getPartnerCcEmail, PARTNERS, type PartnerConfig } from './config';
import { createDecisionToken, type DecisionAction } from './decision-token';

const log = createWebhookLogger('Partner Verification');

// The one-click partner confirmation flow behind the reciprocal-discount
// program. State machine per request row: pending -> confirmed | denied |
// expired. Momence owns the discount itself (tag + price rule); this module
// owns getting the tag onto the right member with the partner's sign-off.

const TABLE = 'partner_verifications';

/** Confirm/deny links and their pending rows live this long. Keep in sync. */
export const DECISION_EXPIRY_DAYS = 14;

const RECONCILIATION_PAGE_SIZE = 100;

function decisionUrl(requestId: string, action: DecisionAction): string | null {
  const token = createDecisionToken(requestId, action, DECISION_EXPIRY_DAYS);
  if (!token) return null;
  // Same origin convention as buildUnsubscribeUrl: PUBLIC_EMAIL_ASSET_BASE may
  // carry a path — only its origin is this app's deployment.
  const origin = import.meta.env.PUBLIC_EMAIL_ASSET_BASE
    ? new URL(import.meta.env.PUBLIC_EMAIL_ASSET_BASE).origin
    : 'https://pyre-integrations.vercel.app';
  return `${origin}/api/partner/decision?token=${token}`;
}

function bookUrl(partner: PartnerConfig): string {
  const site = import.meta.env.PUBLIC_SITE_URL ?? process.env.PUBLIC_SITE_URL ?? 'https://pyresauna.com';
  return `${site}/events?utm_source=${partner.slug}&utm_medium=partner&utm_campaign=${partner.slug}-verified`;
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
  const partner = getPartner(params.partnerSlug);
  if (!partner) return { outcome: 'unavailable', reason: 'unknown-partner' };
  if (!partner.contactEmail) return { outcome: 'unavailable', reason: 'partner-not-configured' };

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

  const confirmUrl = decisionUrl(inserted.id, 'confirm');
  const denyUrl = decisionUrl(inserted.id, 'deny');
  if (!confirmUrl || !denyUrl) {
    await db.from(TABLE).delete().eq('id', inserted.id);
    return { outcome: 'unavailable', reason: 'link-secret-not-configured' };
  }

  try {
    await sendTemplate({
      to: partner.contactEmail,
      cc: getPartnerCcEmail() ?? undefined,
      template: 'partner-verification-request',
      props: {
        partnerName: partner.name,
        customerName: `${params.customerFirstName.trim()} ${params.customerLastName.trim()}`,
        customerEmail,
        customerPhone: params.customerPhone?.trim() || null,
        partnerMemberEmail,
        confirmUrl,
        denyUrl,
        expiresDays: DECISION_EXPIRY_DAYS,
      },
    });
  } catch (error) {
    // No email went out — remove the row so the customer's retry isn't
    // swallowed by the dedupe check above.
    await db.from(TABLE).delete().eq('id', inserted.id);
    throw error;
  }

  await captureEvent({
    distinctId: customerEmail,
    event: 'partner_verification_submitted',
    properties: { partner: partner.slug },
  });

  return { outcome: 'created' };
}

export type DecisionResult =
  | { outcome: 'confirmed' }
  | { outcome: 'denied' }
  | { outcome: 'already-handled'; status: PartnerVerificationRow['status'] }
  | { outcome: 'not-found' };

export async function applyDecision(
  requestId: string,
  action: DecisionAction
): Promise<DecisionResult> {
  const db = getDb();
  if (!db) throw new Error('Supabase not configured');

  const { data: row } = await db
    .from(TABLE)
    .select('*')
    .eq('id', requestId)
    .maybeSingle<PartnerVerificationRow>();
  if (!row) return { outcome: 'not-found' };
  if (row.status !== 'pending') return { outcome: 'already-handled', status: row.status };

  const partner = getPartner(row.partner_slug);
  if (!partner) return { outcome: 'not-found' };

  if (action === 'confirm') {
    // Momence work happens BEFORE the status flip: if tagging fails the row
    // stays pending and the same link retries cleanly.
    const tagId = await getTagIdByName(partner.tagName);
    if (tagId === null) {
      throw new Error(
        `Momence tag "${partner.tagName}" not found — create it in the dashboard first`
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
        discountPercent: partner.discountPercent,
        bookUrl: bookUrl(partner),
      },
    });

    await captureEvent({
      distinctId: row.customer_email,
      event: 'partner_verification_confirmed',
      properties: { partner: partner.slug, momence_member_id: memberId, member_created: memberCreated },
    });

    return { outcome: 'confirmed' };
  }

  const { data: updated } = await db
    .from(TABLE)
    .update({ status: 'denied', decided_at: new Date().toISOString() })
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
    properties: { partner: partner.slug },
  });

  return { outcome: 'denied' };
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

  const cutoff = new Date(Date.now() - DECISION_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await db
    .from(TABLE)
    .select('*')
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .limit(50);
  const rows = (data ?? []) as PartnerVerificationRow[];
  if (rows.length === 0) return { expired: 0, wouldExpire: [] };

  if (ctx.dryRun) {
    return { expired: 0, wouldExpire: rows.map((r) => `${r.partner_slug}:${r.customer_email}`) };
  }

  let expired = 0;
  for (const row of rows) {
    const partner = getPartner(row.partner_slug);
    const { data: updated } = await db
      .from(TABLE)
      .update({ status: 'expired', decided_at: new Date().toISOString() })
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

  for (const partner of Object.values(PARTNERS)) {
    if (!partner.contactEmail) {
      skipped.push(`${partner.slug}:no-contact`);
      continue;
    }
    const tagId = await getTagIdByName(partner.tagName);
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
        filter: { type: 'and', customerTags: { type: 'or', tags: [tagId], customerHaveTag: 'have' } },
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

    const sendKey = `partner-reconciliation:${partner.slug}:${quarter}`;
    if (ctx.dryRun) {
      sent.push(`${sendKey} (${members.length} members, dry run)`);
      continue;
    }

    // The send_key unique index makes this once per quarter per partner — the
    // hourly tick can call it freely.
    const result = await sendTemplate({
      to: partner.contactEmail,
      cc: getPartnerCcEmail() ?? undefined,
      template: 'partner-reconciliation',
      props: { partnerName: partner.name, quarterLabel: quarter, members },
      sendKey,
    });
    if (result.status === 'sent') {
      sent.push(`${sendKey} (${members.length} members)`);
      await captureEvent({
        distinctId: partner.contactEmail,
        event: 'partner_reconciliation_sent',
        properties: { partner: partner.slug, member_count: members.length },
      });
    }
  }

  return { sent, skipped };
}

export async function runPartnerMaintenance(
  ctx: CronJobContext
): Promise<Record<string, unknown>> {
  const expiry = await expirePendingRequests(ctx);
  const reconciliation = await runReconciliation(ctx);
  return {
    expired: expiry.expired,
    reconciliationSent: reconciliation.sent,
    reconciliationSkipped: reconciliation.skipped,
    ...(ctx.dryRun && { wouldExpire: expiry.wouldExpire }),
  };
}
