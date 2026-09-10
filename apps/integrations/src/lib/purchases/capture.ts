// Turns a Momence payment-transaction-succeeded webhook into PostHog
// purchase_completed events for the campaign report.
//
// The webhook carries only a transaction id, and Momence fires it for every
// charge — a pack, a membership, a product, and the $0 booking a pack pays
// for. So: look the transaction up, keep the line items that are packs or
// memberships, work out who the item is for (a gift has a payer and a
// different target), classify it (see ./classify), and capture one event per
// line item keyed by the recipient's email so it stitches to the same person
// as the web signups and bookings. Click→purchase inference fills in the
// campaign for buyers who never identified on the site, exactly as it does
// for bookings.
//
// Idempotent per transaction via a Redis marker set only after every line
// item was captured — a failed capture leaves the marker unset so a Momence
// redelivery (or a manual replay) gets another go. The lookup itself is
// allowed to throw: a 500 makes Momence retry, which is what we want when
// their API hiccups.

import { createWebhookLogger, getRedis, type WebhookTracer } from '@pyre/webhook-core';
import { inferPurchaseAttribution } from '@/lib/analytics/booking-attribution';
import { captureEvent } from '@/lib/analytics/posthog';
import {
  fetchMemberActivePacks,
  fetchPaymentTransaction,
  getIntroOfferMembershipIds,
  type HostPaymentTransaction,
  type SaleMember,
} from '@/lib/momence/host-api';
import { fetchMomenceMember } from '@/lib/webhooks/momence';
import {
  COUNTED_PURCHASE_KINDS,
  classifyPurchase,
  isPurchaseItem,
  type PurchaseKind,
} from './classify';

const log = createWebhookLogger('Purchases');

export const PURCHASE_EVENT = 'purchase_completed';

const CAPTURED_PREFIX = 'purchase:captured:';
const CAPTURED_TTL_SECONDS = 60 * 60 * 24 * 30;

export interface CapturedPurchase {
  kind: PurchaseKind;
  membershipId: number;
  itemName: string;
  email: string;
  captured: boolean;
  attributionMethod?: string;
}

export interface PurchaseCaptureSummary {
  transactionId: number;
  purchaseType?: string;
  skipped?: 'already-captured' | 'not-succeeded' | 'not-a-purchase';
  purchases: CapturedPurchase[];
}

async function alreadyCaptured(transactionId: number): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  return (await redis.exists(`${CAPTURED_PREFIX}${transactionId}`)) === 1;
}

async function markCaptured(transactionId: number): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.set(`${CAPTURED_PREFIX}${transactionId}`, Date.now(), { ex: CAPTURED_TTL_SECONDS });
}

interface MemberIdentity {
  email: string;
  firstName?: string;
  lastName?: string;
}

/** The recipient's email: the transaction already names the payer, so only a
 * gifted item (target ≠ payer) costs a member lookup. */
async function resolveRecipient(
  tx: HostPaymentTransaction,
  target: SaleMember,
  tracer: WebhookTracer
): Promise<MemberIdentity | null> {
  const payer = tx.payingMember;
  if (payer && payer.id === target.id && payer.email) {
    return { email: payer.email, firstName: payer.firstName, lastName: payer.lastName };
  }
  try {
    const member = await tracer.span(
      'Fetch Momence member',
      () => fetchMomenceMember(String(target.id)),
      { memberId: target.id }
    );
    if (!member.email) return null;
    return { email: member.email, firstName: member.firstName, lastName: member.lastName };
  } catch (error) {
    log.warn(`Could not resolve member ${target.id} for transaction ${tx.id}`, error);
    return null;
  }
}

/** The bought record's type (subscription vs package) for a `membership`
 * line item — the sale itself does not say which. Best-effort; null means
 * the item is captured but cannot be counted. */
async function boughtMembershipType(
  memberId: number,
  catalogMembershipId: number
): Promise<string | null> {
  try {
    const packs = await fetchMemberActivePacks(memberId, { fresh: true });
    return packs.find((p) => p.membership?.id === catalogMembershipId)?.type ?? null;
  } catch (error) {
    log.warn(`Could not read bought memberships for member ${memberId}`, error);
    return null;
  }
}

export async function handlePaymentTransaction(
  transactionId: number,
  tracer: WebhookTracer
): Promise<PurchaseCaptureSummary> {
  const summary: PurchaseCaptureSummary = { transactionId, purchases: [] };

  if (await alreadyCaptured(transactionId)) {
    log.info(`Transaction ${transactionId} already captured`);
    return { ...summary, skipped: 'already-captured' };
  }

  const tx = await tracer.span(
    'Fetch payment transaction',
    () => fetchPaymentTransaction(transactionId),
    { transactionId }
  );
  summary.purchaseType = tx.purchaseType;

  if (tx.paymentStatus !== 'succeeded') {
    log.info(`Transaction ${transactionId} is ${tx.paymentStatus}; ignoring`);
    return { ...summary, skipped: 'not-succeeded' };
  }

  // Fast path for the majority of payment webhooks (session bookings,
  // products): no member lookups, no PostHog.
  const lines = tx.sales.flatMap((sale) =>
    sale.items.filter((item) => isPurchaseItem(item.itemType)).map((item) => ({ sale, item }))
  );
  if (lines.length === 0) {
    log.info(`Transaction ${transactionId} is a ${tx.purchaseType}, not a pack or membership`);
    return { ...summary, skipped: 'not-a-purchase' };
  }

  const introOfferIds = getIntroOfferMembershipIds();
  let allCaptured = true;

  for (const { sale, item } of lines) {
    const target = item.targetMember ?? item.payingMember ?? tx.payingMember;
    if (!target) {
      log.warn(`Sale item ${item.id} on transaction ${transactionId} names no member`);
      allCaptured = false;
      continue;
    }

    const recipient = await resolveRecipient(tx, target, tracer);
    if (!recipient) {
      allCaptured = false;
      continue;
    }

    const membershipType =
      item.itemType === 'membership'
        ? await tracer.span(
            'Read bought membership type',
            () => boughtMembershipType(target.id, item.saleItemId),
            { memberId: target.id, membershipId: item.saleItemId }
          )
        : null;

    const kind = classifyPurchase({
      itemType: item.itemType,
      catalogMembershipId: item.saleItemId,
      membershipType,
      paymentSource: tx.paymentSource,
      introOfferIds,
    });

    // Best-effort by contract: inferPurchaseAttribution never throws and
    // self-limits its latency, so it cannot 500 the webhook.
    const attribution = COUNTED_PURCHASE_KINDS.has(kind)
      ? await tracer.span(
          'Infer purchase attribution',
          () => inferPurchaseAttribution(item.saleItemId),
          { membershipId: item.saleItemId }
        )
      : null;

    const email = recipient.email.toLowerCase();
    const payerId = tx.payingMember?.id ?? item.payingMember?.id ?? null;
    const createdAt = new Date(tx.createdAt);

    const captured = await tracer.span(
      'Track purchase event',
      () =>
        captureEvent({
          distinctId: email,
          event: PURCHASE_EVENT,
          ...(Number.isNaN(createdAt.getTime()) ? {} : { timestamp: createdAt }),
          properties: {
            payment_transaction_id: tx.id,
            sale_id: sale.id,
            sale_line_id: item.id,
            membership_id: item.saleItemId,
            item_type: item.itemType,
            item_name: item.itemName,
            purchase_kind: kind,
            membership_type: membershipType,
            quantity: item.quantity,
            unit_price: Number(item.unitPriceExcludingTaxInCurrency),
            amount_paid: Number(tx.paidInCurrency),
            currency: tx.currency,
            discount_code: item.discountCode?.code ?? null,
            payment_source: tx.paymentSource,
            purchase_type: tx.purchaseType,
            paying_member_id: payerId,
            target_member_id: target.id,
            is_gift: payerId != null && payerId !== target.id,
            iso_date: tx.createdAt,
            ...(attribution ?? {}),
            $set: {
              email,
              ...(recipient.firstName ? { first_name: recipient.firstName } : {}),
              ...(recipient.lastName ? { last_name: recipient.lastName } : {}),
            },
          },
        }),
      { kind, membershipId: item.saleItemId, to: email }
    );

    allCaptured &&= captured;
    summary.purchases.push({
      kind,
      membershipId: item.saleItemId,
      itemName: item.itemName,
      email,
      captured,
      ...(attribution?.attribution_method && { attributionMethod: attribution.attribution_method }),
    });
  }

  if (allCaptured) await markCaptured(transactionId);
  return summary;
}
