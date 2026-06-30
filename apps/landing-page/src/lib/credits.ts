// Credit cost derivation.
//
// Momence does not expose a per-event credit cost — the Events API only returns
// a dollar `fixedPrice`. A single credit is priced at $25 (see sessions.ts), so
// an event's credit cost is its drop-in price divided by that, rounded to the
// nearest whole credit (minimum 1).

export const CREDIT_PRICE_USD = 25;

/**
 * Credit cost for a given USD drop-in price. Returns null when the price is
 * unknown or non-positive so callers can omit the credits display entirely.
 */
export function creditsForPriceUsd(priceUsd: number | undefined | null): number | null {
  if (priceUsd === undefined || priceUsd === null || priceUsd <= 0) return null;
  return Math.max(1, Math.round(priceUsd / CREDIT_PRICE_USD));
}
