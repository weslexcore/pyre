import { describe, expect, it } from 'vitest';
import type { BoughtMembership } from '@/lib/momence/host-api';
import { guestPlan, introProgress, isFirstVisit } from './plan';

const NOW = Date.parse('2026-11-02T18:00:00.000Z');
const DAY = 24 * 60 * 60_000;
const day = (offset: number) => new Date(NOW + offset * DAY).toISOString();
const INTRO_ID = 77;

function pack(overrides: Partial<BoughtMembership> = {}): BoughtMembership {
  return {
    id: 1,
    type: 'package-events',
    startDate: day(-10),
    endDate: day(80),
    isFrozen: false,
    eventCreditsLeft: 3,
    eventCreditsTotal: 5,
    moneyCreditsLeft: null,
    moneyCreditsTotal: null,
    membership: { id: 10, name: '5 Pack' },
    ...overrides,
  };
}

const unlimited = pack({
  type: 'subscription',
  eventCreditsLeft: null,
  eventCreditsTotal: null,
  membership: { id: 20, name: 'Founding Unlimited' },
});
const intro = pack({
  type: 'package-events',
  startDate: day(-4),
  endDate: day(10),
  eventCreditsLeft: null,
  eventCreditsTotal: null,
  membership: { id: INTRO_ID, name: 'Intro Offer' },
});

describe('guestPlan', () => {
  it('reads nothing active as none', () => {
    expect(guestPlan([], [INTRO_ID], NOW).kind).toBe('none');
  });

  it('puts unlimited ahead of everything else', () => {
    const plan = guestPlan([pack(), intro, unlimited], [INTRO_ID], NOW);
    expect(plan.kind).toBe('unlimited');
    expect(plan.name).toBe('Founding Unlimited');
  });

  it('treats a subscription named unlimited as unlimited even with a credit count', () => {
    const plan = guestPlan(
      [{ ...unlimited, eventCreditsLeft: 999, eventCreditsTotal: 999 }],
      [INTRO_ID],
      NOW
    );
    expect(plan.kind).toBe('unlimited');
  });

  it('reads the intro with its progress', () => {
    const plan = guestPlan([pack(), intro], [INTRO_ID], NOW);
    expect(plan.kind).toBe('intro');
    expect(plan.intro).toEqual({ day: 5, days: 14, daysLeft: 10 });
  });

  it('does not count an intro sold as a subscription as unlimited', () => {
    const plan = guestPlan([{ ...intro, type: 'subscription' }], [INTRO_ID], NOW);
    expect(plan.kind).toBe('intro');
  });

  it('falls back to the name for the intro when no ids are configured', () => {
    expect(guestPlan([intro], [], NOW).kind).toBe('intro');
  });

  it('reads a membership with credits', () => {
    const plan = guestPlan(
      [
        pack({
          type: 'subscription',
          eventCreditsLeft: 2,
          eventCreditsTotal: 4,
          membership: { id: 30, name: 'Monthly 4' },
        }),
      ],
      [INTRO_ID],
      NOW
    );
    expect(plan).toMatchObject({ kind: 'membership', creditsLeft: 2, creditsTotal: 4 });
  });

  it('adds up credit packs', () => {
    const plan = guestPlan(
      [pack(), pack({ id: 2, eventCreditsLeft: 1, eventCreditsTotal: 1 })],
      [INTRO_ID],
      NOW
    );
    expect(plan).toMatchObject({ kind: 'credits', creditsLeft: 4, moneyLeft: null });
  });

  it('reads a money pack', () => {
    const plan = guestPlan(
      [
        pack({
          type: 'package-money',
          eventCreditsLeft: null,
          eventCreditsTotal: null,
          moneyCreditsLeft: 40,
          moneyCreditsTotal: 100,
        }),
      ],
      [INTRO_ID],
      NOW
    );
    expect(plan).toMatchObject({ kind: 'credits', creditsLeft: null, moneyLeft: 40 });
  });

  it('ignores purchases that have already ended', () => {
    expect(guestPlan([{ ...unlimited, endDate: day(-1) }], [INTRO_ID], NOW).kind).toBe('none');
  });
});

describe('introProgress', () => {
  it('is day 1 on the day it starts', () => {
    expect(introProgress({ ...intro, startDate: day(0), endDate: day(14) }, NOW)).toEqual({
      day: 1,
      days: 14,
      daysLeft: 14,
    });
  });

  it('never runs past the last day', () => {
    expect(
      introProgress({ ...intro, startDate: day(-14), endDate: day(0.1) }, NOW).day
    ).toBeLessThanOrEqual(14);
  });

  it('has no day before it starts, only time left', () => {
    expect(introProgress({ ...intro, startDate: null, endDate: day(14) }, NOW)).toEqual({
      day: null,
      days: null,
      daysLeft: 14,
    });
  });
});

describe('isFirstVisit', () => {
  it('counts today once they are checked in', () => {
    expect(isFirstVisit(0, false)).toBe(true);
    expect(isFirstVisit(1, true)).toBe(true);
    expect(isFirstVisit(1, false)).toBe(false);
    expect(isFirstVisit(2, true)).toBe(false);
  });
});
