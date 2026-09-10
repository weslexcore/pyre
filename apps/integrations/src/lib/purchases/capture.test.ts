// handlePaymentTransaction — the payment-transaction-succeeded webhook path.
// Pins the parts that matter operationally: session/product charges cost no
// member lookup and no PostHog call, a gifted pack is keyed by the recipient,
// and the idempotency marker is set only after every line item captured.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchPaymentTransaction = vi.fn();
const fetchMemberActivePacks = vi.fn();
const getIntroOfferMembershipIds = vi.fn(() => [630918]);
const fetchMomenceMember = vi.fn();
const captureEvent = vi.fn();
const inferPurchaseAttribution = vi.fn();
const getRedis = vi.fn();

vi.mock('@pyre/webhook-core', () => ({
  getRedis: () => getRedis(),
  createWebhookLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/lib/momence/host-api', () => ({
  fetchPaymentTransaction: (id: number) => fetchPaymentTransaction(id),
  fetchMemberActivePacks: (id: number, opts: unknown) => fetchMemberActivePacks(id, opts),
  getIntroOfferMembershipIds: () => getIntroOfferMembershipIds(),
}));
vi.mock('@/lib/webhooks/momence', () => ({
  fetchMomenceMember: (id: string) => fetchMomenceMember(id),
}));
vi.mock('@/lib/analytics/posthog', () => ({
  captureEvent: (params: unknown) => captureEvent(params),
}));
vi.mock('@/lib/analytics/booking-attribution', () => ({
  inferPurchaseAttribution: (id: number) => inferPurchaseAttribution(id),
}));

const { handlePaymentTransaction } = await import('./capture');

const tracer = { span: <T>(_name: string, fn: () => Promise<T>) => fn() } as never;

function fakeRedis(seed: string[] = []) {
  const store = new Set(seed);
  return {
    exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
    set: vi.fn(async (key: string) => {
      store.add(key);
      return 'OK';
    }),
  };
}

const payer = { id: 22073, firstName: 'Ada', lastName: 'Lovelace', email: 'Ada@Example.com' };

const transaction = (over: Record<string, unknown> = {}) => ({
  id: 341635651,
  paymentStatus: 'succeeded',
  currency: 'usd',
  paidInCurrency: '172.65',
  priceExcludingVatInCurrency: '169.15',
  paymentSource: 'checkout-pages',
  purchaseType: 'membership',
  payingMember: payer,
  createdAt: '2026-09-09T23:49:33.174Z',
  refunds: [],
  sales: [
    {
      id: 324460856,
      saleDate: '2026-09-09T23:49:33.174Z',
      items: [
        {
          id: 327197063,
          saleItemId: 756341,
          itemType: 'membership',
          itemName: 'Founding Membership',
          payingMember: { id: 22073, firstName: 'Ada', lastName: 'Lovelace' },
          targetMember: { id: 22073, firstName: 'Ada', lastName: 'Lovelace' },
          quantity: 1,
          unitPriceExcludingTaxInCurrency: '169.15',
          discountCode: { code: 'WORKIT25', type: 'percentage' },
        },
      ],
    },
  ],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  getRedis.mockReturnValue(fakeRedis());
  captureEvent.mockResolvedValue(true);
  inferPurchaseAttribution.mockResolvedValue(null);
  fetchMemberActivePacks.mockResolvedValue([
    { id: 74580257, type: 'subscription', membership: { id: 756341, name: 'Founding' } },
  ]);
});

describe('handlePaymentTransaction', () => {
  it('ignores a session charge without looking anyone up', async () => {
    fetchPaymentTransaction.mockResolvedValue(
      transaction({
        purchaseType: 'session',
        sales: [
          {
            id: 1,
            saleDate: '2026-09-10T00:35:48.891Z',
            items: [
              {
                id: 2,
                saleItemId: 141463870,
                itemType: 'session',
                itemName: 'Open Hours',
                payingMember: { id: 22073 },
                targetMember: { id: 22073 },
                quantity: 1,
                unitPriceExcludingTaxInCurrency: '0',
              },
            ],
          },
        ],
      })
    );

    const summary = await handlePaymentTransaction(341648293, tracer);

    expect(summary.skipped).toBe('not-a-purchase');
    expect(fetchMomenceMember).not.toHaveBeenCalled();
    expect(fetchMemberActivePacks).not.toHaveBeenCalled();
    expect(captureEvent).not.toHaveBeenCalled();
    expect(getRedis().set).not.toHaveBeenCalled();
  });

  it('captures a membership purchase keyed by the lowercased email and stamped at the sale time', async () => {
    fetchPaymentTransaction.mockResolvedValue(transaction());
    inferPurchaseAttribution.mockResolvedValue({
      attribution_method: 'session_click_inference',
      attributed_utm_campaign: 'Instagram Bio Links',
    });
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);

    const summary = await handlePaymentTransaction(341635651, tracer);

    expect(summary.purchases).toEqual([
      expect.objectContaining({
        kind: 'membership',
        membershipId: 756341,
        email: 'ada@example.com',
        captured: true,
        attributionMethod: 'session_click_inference',
      }),
    ]);
    expect(fetchMomenceMember).not.toHaveBeenCalled();
    expect(fetchMemberActivePacks).toHaveBeenCalledWith(22073, { fresh: true });
    expect(inferPurchaseAttribution).toHaveBeenCalledWith(756341);
    expect(captureEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: 'ada@example.com',
        event: 'purchase_completed',
        timestamp: new Date('2026-09-09T23:49:33.174Z'),
        properties: expect.objectContaining({
          payment_transaction_id: 341635651,
          membership_id: 756341,
          purchase_kind: 'membership',
          membership_type: 'subscription',
          amount_paid: 172.65,
          unit_price: 169.15,
          discount_code: 'WORKIT25',
          payment_source: 'checkout-pages',
          is_gift: false,
          attributed_utm_campaign: 'Instagram Bio Links',
          $set: { email: 'ada@example.com', first_name: 'Ada', last_name: 'Lovelace' },
        }),
      })
    );
    expect(redis.set).toHaveBeenCalledWith('purchase:captured:341635651', expect.any(Number), {
      ex: 60 * 60 * 24 * 30,
    });
  });

  it('classifies the intro offer by catalog id and a package as a credit pack', async () => {
    fetchPaymentTransaction.mockResolvedValue(
      transaction({
        sales: [
          {
            id: 1,
            saleDate: '2026-09-09T21:24:01.261Z',
            items: [
              {
                id: 10,
                saleItemId: 630918,
                itemType: 'membership',
                itemName: 'Intro Buy One, Get One!',
                payingMember: { id: 22073 },
                targetMember: { id: 22073 },
                quantity: 1,
                unitPriceExcludingTaxInCurrency: '25',
              },
              {
                id: 11,
                saleItemId: 630916,
                itemType: 'membership',
                itemName: 'Ritual - 8 Credits',
                payingMember: { id: 22073 },
                targetMember: { id: 22073 },
                quantity: 1,
                unitPriceExcludingTaxInCurrency: '123.75',
              },
            ],
          },
        ],
      })
    );
    fetchMemberActivePacks.mockResolvedValue([
      { id: 1, type: 'package-events', membership: { id: 630918, name: 'Intro' } },
      { id: 2, type: 'package-events', membership: { id: 630916, name: 'Ritual' } },
    ]);

    const summary = await handlePaymentTransaction(1, tracer);

    expect(summary.purchases.map((p) => p.kind)).toEqual(['intro_offer', 'credit_pack']);
  });

  it('keys a gifted pack by the recipient, looked up from Momence', async () => {
    fetchPaymentTransaction.mockResolvedValue(
      transaction({
        sales: [
          {
            id: 1,
            saleDate: '2026-09-09T21:24:01.261Z',
            items: [
              {
                id: 10,
                saleItemId: 702636,
                itemType: 'membership',
                itemName: 'Duo - 2 Credits',
                payingMember: { id: 22073 },
                targetMember: { id: 99, firstName: 'Grace', lastName: 'Hopper' },
                quantity: 1,
                unitPriceExcludingTaxInCurrency: '45',
              },
            ],
          },
        ],
      })
    );
    fetchMomenceMember.mockResolvedValue({
      email: 'grace@example.com',
      firstName: 'Grace',
      lastName: 'Hopper',
    });
    fetchMemberActivePacks.mockResolvedValue([
      { id: 3, type: 'package-events', membership: { id: 702636, name: 'Duo' } },
    ]);

    await handlePaymentTransaction(1, tracer);

    expect(fetchMomenceMember).toHaveBeenCalledWith('99');
    expect(fetchMemberActivePacks).toHaveBeenCalledWith(99, { fresh: true });
    expect(captureEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: 'grace@example.com',
        properties: expect.objectContaining({
          is_gift: true,
          paying_member_id: 22073,
          target_member_id: 99,
          purchase_kind: 'credit_pack',
        }),
      })
    );
  });

  it('marks a renewal so the report leaves it out, without click inference', async () => {
    fetchPaymentTransaction.mockResolvedValue(
      transaction({ paymentSource: 'scheduled-job-renew-membership' })
    );

    const summary = await handlePaymentTransaction(1, tracer);

    expect(summary.purchases[0]?.kind).toBe('renewal');
    expect(inferPurchaseAttribution).not.toHaveBeenCalled();
    expect(captureEvent).toHaveBeenCalledWith(
      expect.objectContaining({ properties: expect.objectContaining({ purchase_kind: 'renewal' }) })
    );
  });

  it('skips a transaction it already captured before fetching it', async () => {
    getRedis.mockReturnValue(fakeRedis(['purchase:captured:341635651']));

    const summary = await handlePaymentTransaction(341635651, tracer);

    expect(summary.skipped).toBe('already-captured');
    expect(fetchPaymentTransaction).not.toHaveBeenCalled();
  });

  it('leaves the marker unset when PostHog did not take the event', async () => {
    fetchPaymentTransaction.mockResolvedValue(transaction());
    captureEvent.mockResolvedValue(false);
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);

    const summary = await handlePaymentTransaction(341635651, tracer);

    expect(summary.purchases[0]?.captured).toBe(false);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('lets a failed Momence lookup throw so Momence retries', async () => {
    fetchPaymentTransaction.mockRejectedValue(new Error('Momence API returned 503'));

    await expect(handlePaymentTransaction(1, tracer)).rejects.toThrow('503');
  });
});
