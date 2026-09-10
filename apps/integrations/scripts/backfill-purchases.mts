// One-off backfill: purchase_completed events for the packs and memberships
// sold before the payment-transaction-succeeded webhook was handled (see
// src/lib/purchases/capture.ts).
//
// Source: the latest Momence TOTAL_SALES report snapshot the daily
// business-report-sync stores in Supabase (momence_report_snapshots.raw_items,
// a trailing 12-week window, one row per payment). Each membership-category
// row becomes a purchase_completed event with the SAME property names the live
// webhook path stamps, keyed by the customer's email, at the ORIGINAL payment
// timestamp — so the campaign report's 90-day window fills in immediately and
// first-touch attribution works through the person's $initial_utm_* exactly as
// for live events. No click inference here: purchase_link_clicked did not exist
// yet, and inference from now() would be meaningless for old sales.
//
// Idempotent: transactions that already have a purchase_completed event (live
// or backfilled) are skipped, so re-running is safe.
//
// Run (from apps/integrations, needs SUPABASE_URL + SUPABASE_SECRET_KEY (or
// SUPABASE_SERVICE_ROLE_KEY), POSTHOG_PERSONAL_API_KEY + POSTHOG_PROJECT_ID, and
// MOMENCE_INTRO_OFFER_MEMBERSHIP_IDS in .env; POSTHOG_API_KEY too when executing):
//   tsx scripts/backfill-purchases.mts            # dry run (default)
//   tsx scripts/backfill-purchases.mts --execute  # actually emit events

import { createClient } from '@supabase/supabase-js';
import { PostHog } from 'posthog-node';
import { classifyPurchase, type PurchaseKind } from '../src/lib/purchases/classify';

const BACKFILL_DAYS = 100; // covers the 12-week snapshot window with margin

// Load apps/integrations/.env if present (vars may also come from the shell).
try {
  process.loadEnvFile(new URL('../.env', import.meta.url).pathname);
} catch {
  // no .env file — rely on exported environment variables
}

const HOST = process.env.POSTHOG_HOST || 'https://us.posthog.com';
const PERSONAL_API_KEY = process.env.POSTHOG_PERSONAL_API_KEY;
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID;
const CAPTURE_API_KEY = process.env.POSTHOG_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const INTRO_OFFER_IDS = (process.env.MOMENCE_INTRO_OFFER_MEMBERSHIP_IDS ?? '')
  .split(',')
  .map((s) => Number.parseInt(s.trim(), 10))
  .filter((n) => Number.isFinite(n));
const execute = process.argv.includes('--execute');

if (!PERSONAL_API_KEY || !PROJECT_ID) {
  console.error('Missing POSTHOG_PERSONAL_API_KEY or POSTHOG_PROJECT_ID');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY');
  process.exit(1);
}
if (execute && !CAPTURE_API_KEY) {
  console.error('Missing POSTHOG_API_KEY (required with --execute)');
  process.exit(1);
}
if (INTRO_OFFER_IDS.length === 0) {
  console.warn('MOMENCE_INTRO_OFFER_MEMBERSHIP_IDS is empty — intro offers will count as credit packs');
}

// Local HogQL client on process.env — the app's queryHogQL reads import.meta.env,
// which does not exist under tsx.
async function queryHogQL(query: string): Promise<unknown[][]> {
  const res = await fetch(`${HOST}/api/projects/${PROJECT_ID}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PERSONAL_API_KEY}`,
    },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  });
  if (!res.ok) {
    throw new Error(`PostHog query failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as { results?: unknown[][] };
  return json.results ?? [];
}

// ---------------------------------------------------------------------------
// 1. The latest sales snapshot. Field names are the ones observed on the live
//    report (see src/lib/reports/normalize.ts for the same caution).
interface SalesRow {
  paymentTransactionId?: number;
  saleItemId?: number;
  paymentDate?: string;
  paymentCategory?: string;
  membershipType?: string | null;
  details?: { membershipId?: number; boughtMembershipId?: number } | null;
  paymentItem?: string;
  paymentValue?: number | string;
  refunded?: number | string;
  paymentStatus?: string;
  paymentMethod?: string;
  customerEmail?: string;
  customerName?: string;
  memberId?: number;
  payingMemberId?: number;
  payingCustomerEmail?: string;
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: snapshot, error } = await db
  .from('momence_report_snapshots')
  .select('snapshot_date, range_from, range_to, item_count, raw_items')
  .eq('report_type', 'TOTAL_SALES')
  .order('snapshot_date', { ascending: false })
  .limit(1)
  .maybeSingle();
if (error || !snapshot) {
  console.error('No TOTAL_SALES snapshot found', error?.message ?? '');
  process.exit(1);
}
const rows = (snapshot.raw_items as SalesRow[]) ?? [];
console.log(
  `Snapshot ${snapshot.snapshot_date} (${snapshot.range_from}..${snapshot.range_to}): ${rows.length} rows` +
    (snapshot.item_count > rows.length ? ` (TRUNCATED from ${snapshot.item_count})` : '')
);

// ---------------------------------------------------------------------------
// 2. Transactions PostHog already knows (live captures and earlier backfills).
const knownRows = await queryHogQL(
  `SELECT DISTINCT toString(properties.payment_transaction_id)
   FROM events
   WHERE event = 'purchase_completed'
     AND timestamp >= now() - INTERVAL ${BACKFILL_DAYS} DAY
   LIMIT 5000`
);
const known = new Set(knownRows.map((r) => String(r[0])));

// ---------------------------------------------------------------------------
// 3. Classify every membership-category row the way the live path would.
interface Emission {
  distinctId: string;
  timestamp: Date;
  kind: PurchaseKind;
  properties: Record<string, unknown>;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};
const nameParts = (name: string | undefined): { first?: string; last?: string } => {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  return { first: parts[0], last: parts.length > 1 ? parts.slice(1).join(' ') : undefined };
};

const byKind = new Map<PurchaseKind, number>();
let skippedKnown = 0;
let skippedNoEmail = 0;
let skippedStatus = 0;
let refundedCount = 0;
const toEmit: Emission[] = [];

for (const row of rows) {
  if (row.paymentCategory !== 'membership') continue;
  if (row.paymentStatus && row.paymentStatus !== 'succeeded') {
    skippedStatus++;
    continue;
  }
  const transactionId = num(row.paymentTransactionId);
  const email = (row.customerEmail ?? row.payingCustomerEmail ?? '').trim().toLowerCase();
  const paidAt = row.paymentDate ? new Date(row.paymentDate) : null;
  if (!transactionId || !paidAt || Number.isNaN(paidAt.getTime())) continue;
  if (!email) {
    skippedNoEmail++;
    continue;
  }
  const membershipId = num(row.details?.membershipId);
  const kind = classifyPurchase({
    itemType: 'membership',
    catalogMembershipId: membershipId,
    membershipType: row.membershipType ?? null,
    paymentSource: null,
    introOfferIds: INTRO_OFFER_IDS,
  });
  byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  if (known.has(String(transactionId))) {
    skippedKnown++;
    continue;
  }
  const value = num(row.paymentValue);
  const refunded = num(row.refunded) ?? 0;
  if (refunded > 0) refundedCount++;
  const { first, last } = nameParts(row.customerName);
  toEmit.push({
    distinctId: email,
    timestamp: paidAt,
    kind,
    properties: {
      payment_transaction_id: transactionId,
      sale_line_id: num(row.saleItemId),
      membership_id: membershipId,
      bought_membership_id: num(row.details?.boughtMembershipId),
      item_type: 'membership',
      item_name: row.paymentItem ?? null,
      purchase_kind: kind,
      membership_type: row.membershipType ?? null,
      quantity: 1,
      amount_paid: value,
      refunded,
      payment_method: row.paymentMethod ?? null,
      paying_member_id: num(row.payingMemberId),
      target_member_id: num(row.memberId),
      is_gift: row.payingMemberId != null && row.memberId != null && row.payingMemberId !== row.memberId,
      iso_date: paidAt.toISOString(),
      backfilled: true,
      $set: {
        email,
        ...(first ? { first_name: first } : {}),
        ...(last ? { last_name: last } : {}),
      },
    },
  });
}

// ---------------------------------------------------------------------------
// 4. Report, and emit when --execute.
console.log(`Membership-category rows by kind : ${JSON.stringify(Object.fromEntries(byKind))}`);
console.log(`Already in PostHog (skipped)     : ${skippedKnown}`);
console.log(`Not succeeded (skipped)          : ${skippedStatus}`);
console.log(`No email (skipped)               : ${skippedNoEmail}`);
console.log(`To emit                          : ${toEmit.length} (${refundedCount} carry a refund)`);
const dates = toEmit.map((e) => e.timestamp.getTime());
if (dates.length > 0) {
  console.log(
    `Date range                       : ${new Date(Math.min(...dates)).toISOString()} .. ${new Date(Math.max(...dates)).toISOString()}`
  );
}

if (!execute) {
  console.log('\nDry run — pass --execute to emit events.');
  process.exit(0);
}

const posthog = new PostHog(CAPTURE_API_KEY as string, { host: HOST, flushAt: 20 });
for (const e of toEmit) {
  posthog.capture({
    distinctId: e.distinctId,
    event: 'purchase_completed',
    timestamp: e.timestamp,
    properties: e.properties,
  });
}
await posthog.shutdown();
console.log(`\nEmitted ${toEmit.length} purchase_completed events.`);
