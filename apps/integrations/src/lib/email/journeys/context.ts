import {
  type BoughtMembership,
  fetchHostMember,
  fetchMemberActivePacks,
  fetchMemberBoughtMemberships,
  fetchSessionBookings,
  getIntroOfferMembershipIds,
  type HostMember,
} from '@/lib/momence/host-api';
import { isRecurringMembership } from '@/lib/momence/memberships';
import type { MergeValues } from './merge-fields';
import type { Condition, ConditionType } from './schema';
import { STUDIO_TIME_ZONE } from './timing';

// Live Momence context for one member, and the code behind each condition and
// merge field the journey definitions refer to. Momence is the source of
// truth: everything here is fetched lazily, at most once per member per run,
// right before the decision it feeds.

/** What enrollment remembers about how someone entered (journey_enrollments.context). */
export interface EnrollmentContext {
  /** The booked session, for session-booked journeys. */
  sessionId?: number;
  sessionBookingId?: number;
  sessionStartsAt?: string;
  sessionEndsAt?: string;
  /** Last known intro expiry — the fallback once Momence stops listing the pack as active. */
  introExpiresAt?: string | null;
  /** Last known soonest credit expiry, likewise. */
  creditsExpireAt?: string | null;
}

export interface MemberIdentity {
  memberId: number;
  email: string;
  firstName: string;
  lastName: string;
}

export interface JourneyContext extends MemberIdentity {
  member(): Promise<HostMember>;
  /** Active subscriptions + credit packs. */
  activePacks(): Promise<BoughtMembership[]>;
  /** Every purchase, expired included; null when Momence won't serve history. */
  boughtMemberships(): Promise<BoughtMembership[] | null>;
  enrolledAt: number | null;
  enrollment: EnrollmentContext;
}

export function buildContext(
  identity: MemberIdentity,
  {
    member,
    enrolledAt = null,
    enrollment = {},
    freshPacks = false,
  }: {
    member?: HostMember;
    enrolledAt?: number | null;
    enrollment?: EnrollmentContext;
    /** Bypass the 20h packs cache — for decisions right before a send. */
    freshPacks?: boolean;
  } = {}
): JourneyContext {
  let memberPromise: Promise<HostMember> | null = member ? Promise.resolve(member) : null;
  let packsPromise: Promise<BoughtMembership[]> | null = null;
  let boughtPromise: Promise<BoughtMembership[] | null> | null = null;

  return {
    ...identity,
    enrolledAt,
    enrollment,
    member() {
      memberPromise ??= fetchHostMember(identity.memberId);
      return memberPromise;
    },
    activePacks() {
      packsPromise ??= fetchMemberActivePacks(identity.memberId, { fresh: freshPacks });
      return packsPromise;
    },
    boughtMemberships() {
      boughtPromise ??= fetchMemberBoughtMemberships(identity.memberId);
      return boughtPromise;
    },
  };
}

// --- Pack helpers ---

const DAY_MS = 24 * 60 * 60 * 1000;

function isIntro(pack: BoughtMembership, introIds: readonly number[]): boolean {
  return pack.membership !== null && introIds.includes(pack.membership.id);
}

function hasCreditsLeft(pack: BoughtMembership): boolean {
  return (pack.eventCreditsLeft ?? 0) > 0 || (pack.moneyCreditsLeft ?? 0) > 0;
}

/** Expiry times of active, unfrozen packs that still have credits, soonest first. */
function creditExpiries(packs: BoughtMembership[], now: number): number[] {
  return packs
    .filter((p) => !p.isFrozen && hasCreditsLeft(p) && p.endDate)
    .map((p) => Date.parse(p.endDate as string))
    .filter((t) => Number.isFinite(t) && t > now)
    .sort((a, b) => a - b);
}

/**
 * When their soonest-expiring credits run out: from live packs, else what
 * enrollment last saw (an expired pack drops off the active list).
 */
export async function resolveCreditsExpiry(ctx: JourneyContext): Promise<number | null> {
  const soonest = creditExpiries(await ctx.activePacks(), Date.now())[0];
  if (soonest !== undefined) return soonest;
  const remembered = ctx.enrollment.creditsExpireAt;
  return remembered ? Date.parse(remembered) : null;
}

function latestEnd(packs: BoughtMembership[]): number | null {
  const ends = packs
    .map((p) => (p.endDate ? Date.parse(p.endDate) : Number.NaN))
    .filter(Number.isFinite);
  return ends.length > 0 ? Math.max(...ends) : null;
}

/**
 * When their intro offer expires: the active intro pack's end date, else the
 * most recent intro in their purchase history (an expired pack drops off the
 * active list), else what enrollment last saw.
 */
export async function resolveIntroExpiry(ctx: JourneyContext): Promise<number | null> {
  const introIds = getIntroOfferMembershipIds();
  const active = latestEnd((await ctx.activePacks()).filter((p) => isIntro(p, introIds)));
  if (active !== null) return active;
  const history = await ctx.boughtMemberships();
  const past = history ? latestEnd(history.filter((p) => isIntro(p, introIds))) : null;
  if (past !== null) return past;
  const remembered = ctx.enrollment.introExpiresAt;
  return remembered ? Date.parse(remembered) : null;
}

// --- Conditions ---

type ConditionCheck = (ctx: JourneyContext, condition: Condition) => Promise<boolean>;

const CHECKS: Record<ConditionType, ConditionCheck> = {
  async 'has-active-membership'(ctx) {
    const introIds = getIntroOfferMembershipIds();
    return (await ctx.activePacks()).some((p) => isRecurringMembership(p, introIds));
  },
  async 'has-active-intro'(ctx) {
    const introIds = getIntroOfferMembershipIds();
    const now = Date.now();
    return (await ctx.activePacks()).some(
      (p) => isIntro(p, introIds) && (!p.endDate || Date.parse(p.endDate) > now)
    );
  },
  async 'ever-bought-intro'(ctx) {
    const introIds = getIntroOfferMembershipIds();
    const history = (await ctx.boughtMemberships()) ?? (await ctx.activePacks());
    return history.some((p) => isIntro(p, introIds));
  },
  async 'has-non-intro-purchase'(ctx) {
    const introIds = getIntroOfferMembershipIds();
    // Null-origin packs count — they own something (imported packs).
    return (await ctx.activePacks()).some(
      (p) => !p.membership || !introIds.includes(p.membership.id)
    );
  },
  async 'has-credits'(ctx) {
    return (await ctx.activePacks()).some(hasCreditsLeft);
  },
  async 'credits-expire-within'(ctx, c) {
    const now = Date.now();
    const soonest = creditExpiries(await ctx.activePacks(), now)[0];
    return soonest !== undefined && soonest - now <= (c.count ?? 0) * DAY_MS;
  },
  async 'intro-expired'(ctx, c) {
    const bought = await CHECKS['ever-bought-intro'](ctx, c);
    return bought && !(await CHECKS['has-active-intro'](ctx, c));
  },
  async 'attended-trigger-session'(ctx) {
    const { sessionId, sessionBookingId } = ctx.enrollment;
    if (!sessionId) return false;
    const bookings = await fetchSessionBookings(sessionId);
    const mine = bookings.find((b) =>
      sessionBookingId
        ? b.id === sessionBookingId
        : String(b.member?.id ?? b.memberId ?? b.customerId ?? '') === String(ctx.memberId)
    );
    return Boolean(mine && !mine.cancelledAt && mine.checkedIn);
  },
  async 'visited-since-enrollment'(ctx) {
    if (ctx.enrolledAt === null) return false;
    const lastSeen = Date.parse((await ctx.member()).lastSeen);
    return Number.isFinite(lastSeen) && lastSeen > ctx.enrolledAt;
  },
  async 'has-tag'(ctx, c) {
    const want = (c.tag ?? '').trim().toLowerCase();
    if (!want) return false;
    return (await ctx.member()).customerTags.some((t) => t.name.trim().toLowerCase() === want);
  },
  async 'total-visits-at-least'(ctx, c) {
    return (await ctx.member()).visits.totalVisits >= (c.count ?? 0);
  },
};

export async function checkCondition(ctx: JourneyContext, condition: Condition): Promise<boolean> {
  const result = await CHECKS[condition.type](ctx, condition);
  return condition.negate ? !result : result;
}

/** The first condition that matches, or null. Sequential so cheap checks can short-circuit. */
export async function firstMatch(
  ctx: JourneyContext,
  conditions: Condition[]
): Promise<Condition | null> {
  for (const c of conditions) {
    if (await checkCondition(ctx, c)) return c;
  }
  return null;
}

export async function allMatch(ctx: JourneyContext, conditions: Condition[]): Promise<boolean> {
  for (const c of conditions) {
    if (!(await checkCondition(ctx, c))) return false;
  }
  return true;
}

// --- Merge values ---

export function formatDay(ms: number): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: STUDIO_TIME_ZONE,
    month: 'long',
    day: 'numeric',
  }).format(new Date(ms));
}

function creditsSummary(packs: BoughtMembership[]): { count: number; label: string } | null {
  // Frozen packs can't be used right now, so they don't count as waiting credits.
  const withCredits = packs.filter((p) => !p.isFrozen && hasCreditsLeft(p));
  if (withCredits.length === 0) return null;
  const events = withCredits.reduce((n, p) => n + (p.eventCreditsLeft ?? 0), 0);
  const money = withCredits.reduce((n, p) => n + (p.moneyCreditsLeft ?? 0), 0);
  if (events > 0) return { count: events, label: `${events} credit${events === 1 ? '' : 's'}` };
  return { count: money, label: `$${money} in credit` };
}

/** Live values for the merge fields a piece of content uses. */
export async function mergeValues(ctx: JourneyContext, fields: Set<string>): Promise<MergeValues> {
  const values: MergeValues = { firstName: ctx.firstName };

  if (fields.has('creditsLeft') || fields.has('creditsLabel') || fields.has('creditsExpireOn')) {
    // The same packs the credits-expiry anchor reads: unfrozen, credits left.
    const packs = await ctx.activePacks();
    const summary = creditsSummary(packs);
    if (summary) {
      values.creditsLeft = String(summary.count);
      values.creditsLabel = summary.label;
    }
    const soonest = creditExpiries(packs, Date.now())[0];
    if (soonest !== undefined) values.creditsExpireOn = formatDay(soonest);
  }

  if (fields.has('daysUntilCreditsExpire')) {
    const expiry = await resolveCreditsExpiry(ctx);
    if (expiry !== null) {
      values.daysUntilCreditsExpire = String(
        Math.max(0, Math.ceil((expiry - Date.now()) / DAY_MS))
      );
    }
  }

  if (fields.has('introExpiresOn') || fields.has('daysUntilIntroExpiry')) {
    const expiry = await resolveIntroExpiry(ctx);
    if (expiry !== null) {
      values.introExpiresOn = formatDay(expiry);
      values.daysUntilIntroExpiry = String(Math.max(0, Math.ceil((expiry - Date.now()) / DAY_MS)));
    }
  }

  return values;
}
