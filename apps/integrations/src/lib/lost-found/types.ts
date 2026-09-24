// Lost & Found vocabulary: the fixed lists the form offers and the API
// validates against. Client-bundle-safe (no db/env imports) — the React
// islands import it directly, and the check constraints in the
// lost_and_found migration mirror these lists.
//
// There is deliberately no list of places an item was found. Incidents need
// one — where a fall happened is the point of the report — but a bottle in the
// bin only raises one question of place, and it is "where do I go to get it?".
// That is storage_location, free text, because "shelf B" and "staff room hook"
// are what staff actually say to each other. Where it was picked up told
// nobody anything and made the guest email longer.

// There is no category. "Black water bottle" is already the category and the
// description in the words a guest would use, and picking "Water bottle" from
// a grid after typing it was a tap that told us nothing the title didn't. The
// search box reads titles; the photo does the recognising.

export const LOST_FOUND_STATUSES = [
  'unclaimed',
  'claim_pending',
  'claimed',
  'picked_up',
  'due_for_donation',
  'donated',
  'discarded',
] as const;

export type LostFoundStatus = (typeof LOST_FOUND_STATUSES)[number];

export const STATUS_LABELS: Record<LostFoundStatus, string> = {
  unclaimed: 'Unclaimed',
  claim_pending: 'Claim pending',
  claimed: 'Claimed',
  picked_up: 'Picked up',
  due_for_donation: 'Due for donation',
  donated: 'Donated',
  discarded: 'Discarded',
};

/** Statuses where the item is still physically in the building. */
export const ON_HAND_STATUSES: LostFoundStatus[] = [
  'unclaimed',
  'claim_pending',
  'claimed',
  'due_for_donation',
];

/**
 * Statuses where somebody has said an item is theirs and it is waiting for
 * them: a guest clicked the claim link, or staff recorded that the owner told
 * them directly. The log's "Claimed" tab is this pair, not either one alone.
 */
export const CLAIM_STATUSES: LostFoundStatus[] = ['claim_pending', 'claimed'];

/** Statuses where the item has left our hands — no more emails, no more claims. */
export const CLOSED_STATUSES: LostFoundStatus[] = ['picked_up', 'donated', 'discarded'];

/** Statuses a staff member may set by hand. Claims arrive from the claim link. */
export const STAFF_SETTABLE_STATUSES: LostFoundStatus[] = [
  'unclaimed',
  'claimed',
  'picked_up',
  'donated',
  'discarded',
];

/** How long an unclaimed item waits before it goes to Furbish Thrift. */
export const DONATION_WINDOW_DAYS = 30;

/** Where unclaimed items go. Named in the guest email and on the dashboard. */
export const DONATION_PARTNER = 'Furbish Thrift';

/**
 * How far back before `found_at` we assume the item could have been left.
 * A closing sweep turns up a bottle that may have sat there since the
 * afternoon, so the default window is generous and staff can widen it.
 */
export const DEFAULT_LOOKBACK_HOURS = 6;

/** Widest window we will ask Momence about — a guard, not a policy. */
export const MAX_WINDOW_HOURS = 72;

/** The studio's clock. Day boundaries in the session picker are its days. */
const STUDIO_TIME_ZONE = 'America/New_York';
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-09-21" for the studio's calendar day that `date` falls on. */
export function studioDateOf(date: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return date.toLocaleDateString('en-CA', { timeZone: STUDIO_TIME_ZONE });
}

/** How far the studio's wall clock is ahead of UTC at `ms` (negative here). */
function studioOffsetMs(ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: STUDIO_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  return wall - Math.floor(ms / 1000) * 1000;
}

/** The instant the studio's day `y-m-d` begins. Two passes settle DST days. */
function studioMidnight(y: number, m: number, d: number): number {
  const wall = Date.UTC(y, m - 1, d);
  const guess = wall - studioOffsetMs(wall);
  return wall - studioOffsetMs(guess);
}

/**
 * One studio calendar day as a session window, for jumping straight to a day
 * instead of widening the lookback hour by hour. The end never runs past
 * `now`: nothing after it has been left behind yet. Null for a malformed or
 * future date.
 */
export function studioDayWindow(ymd: string, now: Date): { start: string; end: string } | null {
  const match = YMD_RE.exec(ymd);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const start = studioMidnight(y, m, d);
  const end = Math.min(studioMidnight(y, m, d + 1), now.getTime());
  if (Number.isNaN(start) || end <= start) return null;
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

/**
 * "a" or "an" for what staff actually type into the item field. The vowel test
 * is enough here — the words that break it ("a unicorn", "an hour") are not
 * things that turn up in a bathhouse bin, and "an umbrella", "an orange
 * hoodie", "an AirPod" are.
 */
export function indefiniteArticle(phrase: string): string {
  const head = phrase
    .trim()
    .toLowerCase()
    .replace(/^[^a-z]+/, '');
  return /^[aeiou]/.test(head) ? 'an' : 'a';
}

/**
 * The clause the guest reads in "Did you leave this behind?". The log form
 * shows it live under the item field so whoever is typing can see that "Bottle,
 * black" reads as "we found a bottle, black" before it goes to forty
 * people. The email template composes the same clause the same way.
 */
export function guestItemClause(itemLabel: string): string {
  const label = itemLabel.trim() || 'item';
  return `we found ${indefiniteArticle(label)} ${label.toLowerCase()}`;
}

export function isLostFoundStatus(v: unknown): v is LostFoundStatus {
  return typeof v === 'string' && (LOST_FOUND_STATUSES as readonly string[]).includes(v);
}

export function statusLabel(value: string): string {
  return isLostFoundStatus(value) ? STATUS_LABELS[value] : value;
}

/** Whole days left before an item is due for donation; negative once overdue. */
export function daysUntilDonation(donateAfter: string, now: number = Date.now()): number {
  const due = Date.parse(donateAfter);
  if (Number.isNaN(due)) return 0;
  return Math.ceil((due - now) / 86_400_000);
}
