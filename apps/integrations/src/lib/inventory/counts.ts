// The count's pure rules: when an area is due, when a line needs an admin's
// review, and how far a round has got. Unit-tested; shared by the
// /api/admin/inventory-counts route and the Count tab (client-bundle-safe).
//
// needsReview mirrors the review rule inside inventory_record_count (the
// database decides; this is for the UI's words and the tests).

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
