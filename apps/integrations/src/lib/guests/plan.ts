// What a guest on the floor is on: Founding Unlimited, the intro offer (and
// how far into its two weeks they are), a membership with credits, a credit
// pack, or nothing — plus whether this is their first visit. Pure, so the
// Check Ins island can import the types and the reading is testable; the
// Momence lookups that feed it live in floor-members.ts.

import type { BoughtMembership } from '@/lib/momence/host-api';
import { RECURRING_MEMBERSHIP_TYPES } from '@/lib/momence/memberships';

const DAY_MS = 24 * 60 * 60_000;

/**
 *   unlimited   a recurring membership with no credit limit
 *   intro       the intro offer (Settings → Momence → Intro offer products)
 *   membership  a recurring membership that comes with credits
 *   credits     a credit or money pack
 *   none        nothing active: paying per visit
 */
export type GuestPlanKind = 'unlimited' | 'intro' | 'membership' | 'credits' | 'none';

export interface GuestPlan {
  kind: GuestPlanKind;
  /** The purchase's name in Momence, when there is one. */
  name: string | null;
  /** Sessions left across what they hold; null when it isn't counted in sessions. */
  creditsLeft: number | null;
  creditsTotal: number | null;
  /** Dollars left on money packs; null when they hold none. */
  moneyLeft: number | null;
  frozen: boolean;
  /** For the intro: how far through its window they are. */
  intro: IntroProgress | null;
}

export interface IntroProgress {
  /** Day of the intro they are on, from 1; null before it has started. */
  day: number | null;
  /** Length of the intro in days; null when Momence gives no window. */
  days: number | null;
  /** Whole days until it ends; null without an end date. */
  daysLeft: number | null;
}

/** One guest's standing, as the floor shows it. */
export interface FloorMember {
  plan: GuestPlan;
  /** Momence has never checked them in before today. */
  firstVisit: boolean;
}

function isIntro(pack: BoughtMembership, introIds: readonly number[]): boolean {
  if (pack.membership && introIds.includes(pack.membership.id)) return true;
  // Without the ids configured, the name is the next best signal.
  return introIds.length === 0 && /\bintro/i.test(pack.membership?.name ?? '');
}

function isUnlimited(pack: BoughtMembership): boolean {
  return (
    /unlimited/i.test(pack.membership?.name ?? '') ||
    (pack.eventCreditsTotal === null && pack.moneyCreditsTotal === null)
  );
}

export function introProgress(pack: BoughtMembership, nowMs: number): IntroProgress {
  const start = pack.startDate ? Date.parse(pack.startDate) : Number.NaN;
  const end = pack.endDate ? Date.parse(pack.endDate) : Number.NaN;
  const days =
    Number.isFinite(start) && Number.isFinite(end) && end > start
      ? Math.max(1, Math.round((end - start) / DAY_MS))
      : null;
  const day =
    Number.isFinite(start) && start <= nowMs
      ? Math.min(days ?? Number.POSITIVE_INFINITY, Math.floor((nowMs - start) / DAY_MS) + 1)
      : null;
  const daysLeft = Number.isFinite(end) ? Math.max(0, Math.ceil((end - nowMs) / DAY_MS)) : null;
  return { day, days, daysLeft };
}

function sum(values: (number | null)[]): number | null {
  const counted = values.filter((v): v is number => v !== null);
  return counted.length > 0 ? counted.reduce((a, b) => a + b, 0) : null;
}

function plan(
  kind: GuestPlanKind,
  packs: BoughtMembership[],
  intro: IntroProgress | null = null
): GuestPlan {
  return {
    kind,
    name: packs[0]?.membership?.name ?? null,
    creditsLeft: sum(packs.map((p) => p.eventCreditsLeft)),
    creditsTotal: sum(packs.map((p) => p.eventCreditsTotal)),
    moneyLeft: sum(packs.map((p) => p.moneyCreditsLeft)),
    frozen: packs.some((p) => p.isFrozen),
    intro,
  };
}

/**
 * The one thing that best describes what a guest is on, from their active
 * purchases: unlimited beats the intro beats a membership beats packs.
 * Packs are added up, since a guest can hold more than one.
 */
export function guestPlan(
  packs: readonly BoughtMembership[],
  introIds: readonly number[],
  nowMs: number
): GuestPlan {
  const live = packs.filter((p) => !p.endDate || Date.parse(p.endDate) > nowMs);
  const intros = live.filter((p) => isIntro(p, introIds));
  const recurring = live.filter(
    (p) => RECURRING_MEMBERSHIP_TYPES.has(p.type) && !isIntro(p, introIds)
  );

  const unlimited = recurring.filter(isUnlimited);
  if (unlimited.length > 0) return plan('unlimited', unlimited);
  if (intros.length > 0) {
    const latest = [...intros].sort((a, b) => (b.endDate ?? '').localeCompare(a.endDate ?? ''));
    return plan('intro', latest, introProgress(latest[0], nowMs));
  }
  if (recurring.length > 0) return plan('membership', recurring);
  const packsLeft = live.filter((p) => !RECURRING_MEMBERSHIP_TYPES.has(p.type));
  if (packsLeft.length > 0) return plan('credits', packsLeft);
  return plan('none', []);
}

/**
 * Momence counts today's visit once they're checked in, so a first-timer
 * has no visits, or just this one.
 */
export function isFirstVisit(visitsAttended: number, checkedIn: boolean): boolean {
  return visitsAttended <= (checkedIn ? 1 : 0);
}
