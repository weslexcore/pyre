import { describe, expect, it, vi } from 'vitest';
import type { BoughtMembership } from '@/lib/momence/host-api';
import { checkCondition, type JourneyContext } from './context';

const INTRO_ID = 943000;

vi.mock('@/lib/momence/host-api', () => ({
  fetchHostMember: vi.fn(),
  fetchMemberActivePacks: vi.fn(async () => []),
  fetchMemberBoughtMemberships: vi.fn(async () => []),
  fetchSessionBookings: vi.fn(async () => []),
  getIntroOfferMembershipIds: vi.fn(async () => [INTRO_ID]),
}));

const DAY = 24 * 3_600_000;
const inDays = (d: number) => new Date(Date.now() + d * DAY).toISOString();

function intro(overrides: Partial<BoughtMembership> = {}): BoughtMembership {
  return {
    id: 1,
    type: 'subscription',
    startDate: null,
    endDate: null,
    isFrozen: false,
    eventCreditsLeft: null,
    eventCreditsTotal: null,
    moneyCreditsLeft: null,
    moneyCreditsTotal: null,
    membership: { id: INTRO_ID, name: 'Unlimited Intro' },
    ...overrides,
  };
}

function ctxWith(cached: BoughtMembership[], fresh: BoughtMembership[] = cached) {
  const freshActivePacks = vi.fn(async () => fresh);
  const ctx: JourneyContext = {
    memberId: 1,
    email: 'a@b.c',
    firstName: 'Ana',
    lastName: '',
    enrolledAt: null,
    enrollment: {},
    member: async () => {
      throw new Error('not needed');
    },
    activePacks: async () => cached,
    freshActivePacks,
    boughtMemberships: async () => cached,
  };
  return { ctx, freshActivePacks };
}

const activatedCheck = { type: 'intro-activated', negate: false } as const;

describe('intro-activated', () => {
  it('is false for a bought intro nobody has booked with yet', async () => {
    const { ctx } = ctxWith([intro()]);
    expect(await checkCondition(ctx, activatedCheck)).toBe(false);
  });

  it('is true once Momence has set the start and end dates', async () => {
    const { ctx, freshActivePacks } = ctxWith([
      intro({ startDate: inDays(-2), endDate: inDays(12) }),
    ]);
    expect(await checkCondition(ctx, activatedCheck)).toBe(true);
    expect(freshActivePacks).not.toHaveBeenCalled();
  });

  it('re-reads Momence when the cached pack is still unactivated', async () => {
    const { ctx, freshActivePacks } = ctxWith(
      [intro()],
      [intro({ startDate: inDays(0), endDate: inDays(14) })]
    );
    expect(await checkCondition(ctx, activatedCheck)).toBe(true);
    expect(freshActivePacks).toHaveBeenCalledOnce();
  });

  it('does not call Momence again for someone with no intro at all', async () => {
    const { ctx, freshActivePacks } = ctxWith([
      intro({ membership: { id: 630915, name: 'Circle' } }),
    ]);
    expect(await checkCondition(ctx, activatedCheck)).toBe(false);
    expect(freshActivePacks).not.toHaveBeenCalled();
  });

  it('is false once the intro has run out', async () => {
    const { ctx } = ctxWith([intro({ startDate: inDays(-15), endDate: inDays(-1) })]);
    expect(await checkCondition(ctx, activatedCheck)).toBe(false);
  });

  it('negates to "not activated yet"', async () => {
    const { ctx } = ctxWith([intro()]);
    expect(await checkCondition(ctx, { ...activatedCheck, negate: true })).toBe(true);
  });
});
