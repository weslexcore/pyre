import { describe, expect, it } from 'vitest';
import type { BoughtMembership } from '@/lib/momence/host-api';
import { checkCondition, type JourneyContext, mergeValues, resolveCreditsExpiry } from './context';
import { isStale, stepDueAt } from './timing';

const DAY = 24 * 3_600_000;

function pack(overrides: Partial<BoughtMembership>): BoughtMembership {
  return {
    id: 1,
    type: 'package-events',
    startDate: null,
    endDate: null,
    isFrozen: false,
    eventCreditsLeft: 2,
    eventCreditsTotal: 4,
    moneyCreditsLeft: null,
    moneyCreditsTotal: null,
    membership: { id: 630915, name: 'Circle' },
    ...overrides,
  };
}

function ctxWith(packs: BoughtMembership[], remembered?: string): JourneyContext {
  return {
    memberId: 1,
    email: 'a@b.c',
    firstName: 'Ana',
    lastName: '',
    enrolledAt: null,
    enrollment: remembered ? { creditsExpireAt: remembered } : {},
    member: async () => {
      throw new Error('not needed');
    },
    activePacks: async () => packs,
    boughtMemberships: async () => packs,
  };
}

const inDays = (d: number) => new Date(Date.now() + d * DAY).toISOString();

describe('credits expiry', () => {
  it('anchors on the soonest pack that still has credits, ignoring frozen and empty ones', async () => {
    const ctx = ctxWith([
      pack({ id: 1, endDate: inDays(3), eventCreditsLeft: 0 }),
      pack({ id: 2, endDate: inDays(5), isFrozen: true }),
      pack({ id: 3, endDate: inDays(10) }),
      pack({ id: 4, endDate: inDays(20) }),
    ]);
    const expiry = await resolveCreditsExpiry(ctx);
    expect(Math.round(((expiry as number) - Date.now()) / DAY)).toBe(10);
  });

  it('falls back to what enrollment remembered once the pack is gone', async () => {
    const remembered = inDays(-1);
    expect(await resolveCreditsExpiry(ctxWith([], remembered))).toBe(Date.parse(remembered));
  });

  it('matches "credits expiring within N days" only inside the window', async () => {
    const ctx = ctxWith([pack({ endDate: inDays(10) })]);
    expect(
      await checkCondition(ctx, { type: 'credits-expire-within', count: 14, negate: false })
    ).toBe(true);
    expect(
      await checkCondition(ctx, { type: 'credits-expire-within', count: 7, negate: false })
    ).toBe(false);
    expect(
      await checkCondition(ctx, { type: 'credits-expire-within', count: 7, negate: true })
    ).toBe(true);
    // No expiry date at all never counts as expiring.
    expect(
      await checkCondition(ctxWith([pack({ endDate: null })]), {
        type: 'credits-expire-within',
        count: 14,
        negate: false,
      })
    ).toBe(false);
  });

  it('fills the credit merge fields from the same packs', async () => {
    const values = await mergeValues(
      ctxWith([
        pack({ endDate: inDays(3), eventCreditsLeft: 2 }),
        pack({ endDate: inDays(30), eventCreditsLeft: 1 }),
      ]),
      new Set(['creditsLabel', 'creditsExpireOn', 'daysUntilCreditsExpire'])
    );
    expect(values.creditsLabel).toBe('3 credits');
    expect(values.daysUntilCreditsExpire).toBe('3');
    expect(values.creditsExpireOn).toBeTruthy();
  });

  it('times "3 days before credits expire" and never sends it after they have', () => {
    const anchors = {
      triggerAt: 0,
      previousAt: null,
      introExpiresAt: null,
      creditsExpireAt: 10 * DAY,
    };
    const timing = { anchor: 'credits-expiry' as const, offsetHours: -72 };
    expect(stepDueAt(timing, anchors)).toBe(7 * DAY);
    expect(isStale(timing, 7 * DAY, anchors, 7 * DAY + 3_600_000)).toBe(false);
    expect(isStale(timing, 7 * DAY, anchors, 10 * DAY + 1)).toBe(true);
  });
});
