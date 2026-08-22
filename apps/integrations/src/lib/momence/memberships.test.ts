// The business rule behind "active members": recurring monthly plans only.
import { describe, expect, it } from 'vitest';
import type { BoughtMembership } from './host-api';
import { hasRecurringMembership, isRecurringMembership } from './memberships';

const pack = (over: Partial<BoughtMembership> = {}): BoughtMembership => ({
  id: 1,
  type: 'subscription',
  startDate: null,
  endDate: null,
  isFrozen: false,
  eventCreditsLeft: null,
  eventCreditsTotal: null,
  moneyCreditsLeft: null,
  moneyCreditsTotal: null,
  membership: null,
  ...over,
});

describe('isRecurringMembership', () => {
  it('counts the recurring plan types', () => {
    for (const type of ['subscription', 'on-demand-subscription', 'patron'] as const) {
      expect(isRecurringMembership(pack({ type }), [])).toBe(true);
    }
  });

  it('rejects credit packs — bought once, burned down, never re-billed', () => {
    expect(isRecurringMembership(pack({ type: 'package-events' }), [])).toBe(false);
    expect(isRecurringMembership(pack({ type: 'package-money' }), [])).toBe(false);
  });

  it('rejects a frozen subscription, which bills nothing this month', () => {
    expect(isRecurringMembership(pack({ isFrozen: true }), [])).toBe(false);
  });

  it('rejects the intro offer even when Momence sells it as a subscription', () => {
    const intro = pack({ membership: { id: 77, name: 'Intro Offer' } });
    expect(isRecurringMembership(intro, [77])).toBe(false);
    // Same purchase, not configured as an intro — a regular member.
    expect(isRecurringMembership(intro, [99])).toBe(true);
  });

  it('keeps a plan with no origin catalog row', () => {
    expect(isRecurringMembership(pack({ membership: null }), [77])).toBe(true);
  });
});

describe('hasRecurringMembership', () => {
  it('is true when any one purchase qualifies', () => {
    expect(
      hasRecurringMembership([pack({ type: 'package-events' }), pack({ type: 'subscription' })], [])
    ).toBe(true);
  });

  it('is false for someone holding only packs', () => {
    expect(
      hasRecurringMembership(
        [pack({ type: 'package-events' }), pack({ type: 'package-money' })],
        []
      )
    ).toBe(false);
  });

  it('is false for someone with nothing active', () => {
    expect(hasRecurringMembership([], [])).toBe(false);
  });
});
