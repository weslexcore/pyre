// The count's pure rules: when an area or an item is due, when a line needs an admin's
// review, and how far a round has got. Unit-tested; shared by the
// /api/admin/inventory-counts route and the Count tab (client-bundle-safe).
//
// needsReview mirrors the review rule inside inventory_record_count (the
// database decides; this is for the UI's words and the tests).

import { easternDate } from '@pyre/schedule-core';
import type { AreaDueStatus, InventoryCountLineRow, InventorySettings } from './types';

const DAY_MS = 86_400_000;

/** Past this multiple of its interval, a due area is overdue. */
export const OVERDUE_FACTOR = 1.5;

export const DEFAULT_SETTINGS: InventorySettings = { review_pct: 20, review_cents: 2500 };

/**
 * Whether an area should be counted: never counted or past its interval is
 * due, well past it is overdue. An area with no schedule is unscheduled.
 */
export function areaDueStatus(
  lastCountedAt: string | null,
  everyDays: number | null,
  now: Date
): AreaDueStatus {
  if (!everyDays) return 'unscheduled';
  if (!lastCountedAt) return 'due';
  const age = (now.getTime() - Date.parse(lastCountedAt)) / DAY_MS;
  if (age > everyDays * OVERDUE_FACTOR) return 'overdue';
  if (age >= everyDays) return 'due';
  return 'ok';
}

/** Whole studio days from one YYYY-MM-DD to another. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS);
}

/**
 * Whether an item with its own count schedule should be counted. Unlike an
 * area's, this counts studio calendar days, so "daily" (1) is due again each
 * new day however late yesterday's count was: due once `everyDays` days have
 * turned over since the last count, overdue past OVERDUE_FACTOR times that.
 * `lastCountedAt` is its least recently counted spot (null = never counted).
 */
export function itemDueStatus(
  lastCountedAt: string | null,
  everyDays: number,
  now: Date
): Exclude<AreaDueStatus, 'unscheduled'> {
  if (!lastCountedAt) return 'due';
  const days = daysBetween(easternDate(new Date(lastCountedAt)), easternDate(now));
  if (days > everyDays * OVERDUE_FACTOR) return 'overdue';
  if (days >= everyDays) return 'due';
  return 'ok';
}

/**
 * When an item was last fully counted: the oldest of its spots' latest
 * counts, or null when any spot has never been counted (or it has none).
 */
export function itemLastCounted(
  areaIds: readonly string[],
  lastBySpot: ReadonlyMap<string, string>
): string | null {
  if (areaIds.length === 0) return null;
  let oldest: string | null = null;
  for (const areaId of areaIds) {
    const at = lastBySpot.get(areaId);
    if (!at) return null;
    if (oldest === null || at < oldest) oldest = at;
  }
  return oldest;
}

/** The count frequencies offered for an item, in studio days. */
export const ITEM_COUNT_SCHEDULES = [1, 7, 14, 30] as const;

/** 'Daily', 'Weekly', 'Every 2 weeks', 'Monthly', or 'Every 3 days'. */
export function countEveryLabel(days: number): string {
  if (days === 1) return 'Daily';
  if (days === 7) return 'Weekly';
  if (days === 14) return 'Every 2 weeks';
  if (days === 30) return 'Monthly';
  return `Every ${days} days`;
}

/** Sort weight for the Count tab: overdue, due, then the rest. */
export const DUE_ORDER: Record<AreaDueStatus, number> = {
  overdue: 0,
  due: 1,
  ok: 2,
  unscheduled: 3,
};

/**
 * Whether a line's difference is big enough for an admin to look at: more
 * than the percent of what was expected (any difference from nothing
 * counts), or more than the dollar threshold.
 */
export function needsReview(
  variance: number,
  expected: number,
  varianceCents: number | null,
  settings: InventorySettings
): boolean {
  if (variance === 0) return false;
  if (Math.abs(variance) * 100 > settings.review_pct * expected) return true;
  return Math.abs(varianceCents ?? 0) > settings.review_cents;
}

/** Shortfall and found stock across lines, in units and cents. */
export function countTotals(
  lines: readonly Pick<InventoryCountLineRow, 'variance' | 'variance_cents'>[]
) {
  const totals = { shortUnits: 0, shortCents: 0, foundUnits: 0, foundCents: 0 };
  for (const line of lines) {
    const v = Number(line.variance);
    const cents = line.variance_cents ?? 0;
    if (v < 0) {
      totals.shortUnits += -v;
      totals.shortCents += -cents;
    } else if (v > 0) {
      totals.foundUnits += v;
      totals.foundCents += cents;
    }
  }
  return totals;
}

/** "Count – Oct 2" — the default name for a new round. */
export function defaultRoundName(now: Date): string {
  return `Count – ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })}`;
}
