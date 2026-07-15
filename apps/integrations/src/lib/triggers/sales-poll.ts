import { createWebhookLogger, getRedis } from '@pyre/webhook-core';
import { captureEvent } from '@/lib/analytics/posthog';
import type { CronJobContext } from '@/lib/cron/jobs';
import { fetchSales, type HostSale } from '@/lib/momence/host-api';
import { dispatchTrigger } from './dispatch';

const log = createWebhookLogger('Sales Poll');

// Momence documents no purchase webhooks, so purchases are discovered by
// polling GET /host/sales (experimental endpoint — Momence support must enable
// it; until then this job reports the API error and does nothing). Each new
// sale line item of interest becomes:
//   - a PostHog `purchase_completed` event (revenue analytics for free)
//   - a `purchase` trigger for event-enrolled journeys (e.g. post-intro-offer)
// The cursor (`sales:cursor` = highest processed sale id) lives in Redis.

const CURSOR_KEY = 'sales:cursor';
const PAGE_SIZE = 50;
const MAX_PAGES_PER_TICK = 5;
const MIN_REMAINING_MS = 10_000;

// Line items that represent a customer buying something worth reacting to.
const INTERESTING_ITEM_TYPES = new Set([
  'membership',
  'monthly-subscription',
  'event-credit',
  'money-credit',
  'gift-card',
]);

export async function runSalesPoll(ctx: CronJobContext): Promise<Record<string, unknown>> {
  const redis = getRedis();
  if (!redis) return { skipped: 'redis-not-configured' };

  const cursor = await redis.get<number>(CURSOR_KEY);

  let sales: HostSale[];
  try {
    sales = await fetchSales(0, PAGE_SIZE, 'DESC');
  } catch (error) {
    // Expected until Momence support enables the experimental endpoint.
    return { error: error instanceof Error ? error.message : String(error) };
  }

  if (cursor == null) {
    // First run: baseline at the newest sale instead of replaying history —
    // journeys should react to purchases from now on, not blast old customers.
    const newest = sales[0]?.id ?? 0;
    if (!ctx.dryRun) await redis.set(CURSOR_KEY, newest);
    log.info(`Baselined sales cursor at ${newest}`);
    return { baselined: newest };
  }

  // Collect everything newer than the cursor (newest-first pages).
  const newSales: HostSale[] = [];
  let page = 0;
  let reachedCursor = sales.some((s) => s.id <= cursor);
  newSales.push(...sales.filter((s) => s.id > cursor));

  while (
    !reachedCursor &&
    page + 1 < MAX_PAGES_PER_TICK &&
    ctx.timeRemainingMs() > MIN_REMAINING_MS
  ) {
    page += 1;
    const batch = await fetchSales(page, PAGE_SIZE, 'DESC');
    if (batch.length === 0) break;
    reachedCursor = batch.some((s) => s.id <= cursor);
    newSales.push(...batch.filter((s) => s.id > cursor));
  }

  // Process oldest-first so journey enrollment order matches purchase order.
  newSales.sort((a, b) => a.id - b.id);

  let purchases = 0;
  for (const sale of newSales) {
    for (const item of sale.items) {
      if (!INTERESTING_ITEM_TYPES.has(item.itemType)) continue;
      const member = item.targetMember ?? item.payingMember;
      if (!member?.email) continue;

      purchases += 1;
      if (ctx.dryRun) continue;

      await captureEvent({
        distinctId: member.email.toLowerCase(),
        event: 'purchase_completed',
        properties: {
          sale_id: sale.id,
          item_type: item.itemType,
          item_name: item.itemName,
          sale_item_id: item.saleItemId,
          unit_price: item.unitPriceExcludingTaxInCurrency,
          quantity: item.quantity,
          iso_date: sale.saleDate,
          $set: { email: member.email, first_name: member.firstName, last_name: member.lastName },
        },
      });

      await dispatchTrigger({
        type: 'purchase',
        memberId: member.id,
        email: member.email,
        firstName: member.firstName,
        lastName: member.lastName,
        saleId: sale.id,
        itemType: item.itemType,
        itemName: item.itemName,
        saleItemId: item.saleItemId,
        unitPrice: item.unitPriceExcludingTaxInCurrency,
      });
    }
  }

  const newCursor = newSales.length > 0 ? newSales[newSales.length - 1].id : cursor;
  if (!ctx.dryRun && newCursor !== cursor) {
    await redis.set(CURSOR_KEY, newCursor);
  }

  return { newSales: newSales.length, purchases, cursor: newCursor };
}
