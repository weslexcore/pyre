// What Momence's raw history says about a guest, in the terms staff use:
// which kinds of session they come to, when they tend to come, and whether
// they are a member or on a pack. Pure functions over already-fetched data,
// so the profile page and the roster share one reading of the numbers and
// the reading is testable without the network.

import type { BoughtMembership } from '@/lib/momence/host-api';

// --- Session history ---

/** One past (or upcoming) session a member is booked into, normalised. */
export interface HistoryEntry {
  name: string;
  startsAt: string;
  /** True when Momence marked them as having shown up. */
  checkedIn: boolean;
  cancelled: boolean;
}

/**
 * Momence's member-sessions rows have not been stable across API revisions
 * and are not documented, so every spelling we might meet is optional and
 * `normalizeHistoryEntry` picks whichever is present. A row with no start
 * time is useless and is dropped.
 */
export interface RawMemberSession {
  id?: number | string;
  name?: string | null;
  title?: string | null;
  startsAt?: string | null;
  startDate?: string | null;
  checkedIn?: boolean | null;
  isCheckedIn?: boolean | null;
  attended?: boolean | null;
  cancelledAt?: string | null;
  isCancelled?: boolean | null;
  session?: {
    id?: number | string;
    name?: string | null;
    title?: string | null;
    startsAt?: string | null;
    startDate?: string | null;
  } | null;
}

export function normalizeHistoryEntry(raw: RawMemberSession): HistoryEntry | null {
  const nested = raw.session ?? null;
  const startsAt = raw.startsAt ?? raw.startDate ?? nested?.startsAt ?? nested?.startDate ?? null;
  if (!startsAt || Number.isNaN(Date.parse(startsAt))) return null;
  const name = (raw.name ?? raw.title ?? nested?.name ?? nested?.title ?? '').trim() || 'Session';
  return {
    name,
    startsAt: new Date(startsAt).toISOString(),
    checkedIn: raw.checkedIn === true || raw.isCheckedIn === true || raw.attended === true,
    cancelled: raw.isCancelled === true || (raw.cancelledAt != null && raw.cancelledAt !== ''),
  };
}

/**
 * The session type as staff name it, from the session's title. Momence tags
 * carry the canonical type for confirmation emails (lib/momence-events.ts),
 * but the member-history rows only carry a title, so this is keyword-based
 * and deliberately forgiving. Order matters: "Silent Social" is not a thing
 * we run, but "Guided Sound Bath" is guided first.
 */
const TYPE_KEYWORDS: [string, string][] = [
  ['guided', 'Guided'],
  ['silent', 'Silent'],
  ['social', 'Social'],
  ['open hours', 'Open hours'],
  ['open sauna', 'Open hours'],
  ['sound', 'Sound bath'],
  ['yoga', 'Yoga'],
  ['breath', 'Breathwork'],
  ['private', 'Private'],
  ['workshop', 'Workshop'],
];

export function classifySessionName(name: string): string {
  const lower = name.toLowerCase();
  for (const [keyword, type] of TYPE_KEYWORDS) {
    if (lower.includes(keyword)) return type;
  }
  return 'Other';
}

export type TimeOfDay = 'mornings' | 'afternoons' | 'evenings';

export interface HistorySummary {
  /** Bookings that were not cancelled. */
  booked: number;
  /** Of those, the ones Momence marked as attended. */
  attended: number;
  /** Session type -> attended (or, failing any check-in data, booked) count. */
  byType: { type: string; count: number }[];
  /** The type they come to most, when there is a clear one. */
  favouriteType: string | null;
  /** Weekday they come on most ("Tuesday"), when one stands out. */
  favouriteDay: string | null;
  favouriteTimeOfDay: TimeOfDay | null;
  /** Most recent sessions, newest first, for the profile's history list. */
  recent: (HistoryEntry & { type: string })[];
}

const WEEKDAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'long',
});
const HOUR_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  hour12: false,
});

function easternWeekday(iso: string): string {
  return WEEKDAY_FORMAT.format(new Date(iso));
}

function easternTimeOfDay(iso: string): TimeOfDay {
  const hour = Number.parseInt(HOUR_FORMAT.format(new Date(iso)), 10) % 24;
  if (hour < 12) return 'mornings';
  if (hour < 17) return 'afternoons';
  return 'evenings';
}

/**
 * The key with the most votes, only when it leads outright (no tie) and
 * holds at least `minShare` of the total. One visit is never a pattern.
 */
function leader<K extends string>(counts: Map<K, number>, minShare: number): K | null {
  let total = 0;
  let best: K | null = null;
  let bestCount = 0;
  let runnerUp = 0;
  for (const [key, count] of counts) {
    total += count;
    if (count > bestCount) {
      runnerUp = bestCount;
      best = key;
      bestCount = count;
    } else if (count > runnerUp) {
      runnerUp = count;
    }
  }
  if (!best || total < 2 || bestCount === runnerUp) return null;
  return bestCount / total >= minShare ? best : null;
}

/**
 * Roll a member's session history up into the handful of facts the profile
 * shows. Only sessions that have already started count toward habits — an
 * upcoming booking is a plan, not a pattern — and cancelled rows count for
 * nothing. Attendance is used when Momence provides it; when no row carries
 * a check-in at all (older API shapes), bookings stand in so the mix still
 * renders rather than showing zeros.
 */
export function summarizeHistory(
  entries: HistoryEntry[],
  nowMs: number = Date.now(),
  recentLimit = 8
): HistorySummary {
  const live = entries.filter((e) => !e.cancelled);
  const past = live.filter((e) => Date.parse(e.startsAt) <= nowMs);
  const anyCheckIn = past.some((e) => e.checkedIn);
  const counted = anyCheckIn ? past.filter((e) => e.checkedIn) : past;

  const typeCounts = new Map<string, number>();
  const dayCounts = new Map<string, number>();
  const timeCounts = new Map<TimeOfDay, number>();
  for (const entry of counted) {
    const type = classifySessionName(entry.name);
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    const day = easternWeekday(entry.startsAt);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    const tod = easternTimeOfDay(entry.startsAt);
    timeCounts.set(tod, (timeCounts.get(tod) ?? 0) + 1);
  }

  const byType = [...typeCounts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

  const recent = [...live]
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .slice(0, recentLimit)
    .map((entry) => ({ ...entry, type: classifySessionName(entry.name) }));

  return {
    booked: live.length,
    attended: past.filter((e) => e.checkedIn).length,
    byType,
    favouriteType: leader(typeCounts, 0.4),
    favouriteDay: leader(dayCounts, 0.4),
    favouriteTimeOfDay: leader(timeCounts, 0.5),
    recent,
  };
}

/** "Usually Tuesday evenings" / "Usually evenings" / null. */
export function habitLine(
  summary: Pick<HistorySummary, 'favouriteDay' | 'favouriteTimeOfDay'>
): string | null {
  const parts = [summary.favouriteDay, summary.favouriteTimeOfDay].filter(Boolean);
  return parts.length > 0 ? `Usually ${parts.join(' ')}` : null;
}

// --- Purchases ---

export type MembershipStanding = 'member' | 'pack' | 'none';

export interface PackSummary {
  name: string;
  type: BoughtMembership['type'];
  recurring: boolean;
  frozen: boolean;
  /** Sessions left on a credit pack; null for money packs and subscriptions. */
  creditsLeft: number | null;
  creditsTotal: number | null;
  /** Dollars left on a money pack; null otherwise. */
  moneyLeft: number | null;
  startDate: string | null;
  endDate: string | null;
}

const RECURRING = new Set<BoughtMembership['type']>([
  'subscription',
  'on-demand-subscription',
  'patron',
]);

export function summarizePack(pack: BoughtMembership): PackSummary {
  return {
    name: pack.membership?.name ?? pack.type,
    type: pack.type,
    recurring: RECURRING.has(pack.type),
    frozen: pack.isFrozen,
    creditsLeft: pack.eventCreditsLeft,
    creditsTotal: pack.eventCreditsTotal,
    moneyLeft: pack.moneyCreditsLeft,
    startDate: pack.startDate,
    endDate: pack.endDate,
  };
}

/**
 * Member (a live recurring subscription, frozen or not — they are still a
 * member while frozen), on a pack (any other active purchase), or neither.
 */
export function membershipStanding(packs: readonly PackSummary[]): MembershipStanding {
  if (packs.some((p) => p.recurring)) return 'member';
  if (packs.length > 0) return 'pack';
  return 'none';
}

export const STANDING_LABELS: Record<MembershipStanding, string> = {
  member: 'Member',
  pack: 'On a pack',
  none: 'Drop-in',
};
