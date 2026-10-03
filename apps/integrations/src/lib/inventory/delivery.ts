// The receive form's delivery fields, shared by the stock screen's Receive
// (/api/admin/inventory-movements) and the Re-order tab's Received
// (/api/admin/inventory-orders). Server-only (returns ready 400 Responses).

import { isUuid, json } from '@/lib/http/json';
import { lotsToUnits, parseQuantity } from './rules';

const REASON_MAX = 120;
const REASONS_MAX = 8;

const text = (raw: unknown, max: number): string | null =>
  typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, max) : null;

/**
 * Every reason ticked or typed for a reject: trimmed, blanks and repeats
 * (ignoring case) dropped, in the order given. Null when it isn't a list of
 * strings or has too many.
 */
export function parseReasons(raw: unknown): string[] | null {
  if (raw == null) return [];
  if (!Array.isArray(raw) || !raw.every((r) => typeof r === 'string')) return null;
  const seen = new Set<string>();
  const reasons: string[] = [];
  for (const r of raw as string[]) {
    const reason = text(r, REASON_MAX);
    if (!reason || seen.has(reason.toLowerCase())) continue;
    seen.add(reason.toLowerCase());
    reasons.push(reason);
  }
  return reasons.length > REASONS_MAX ? null : reasons;
}

/**
 * The receive form's delivery fields: accepted units (or whole lots), rejected
 * units with their reasons, and the held rejects picked up with it. Shared
 * with the Re-order tab's receive (inventory-orders).
 */
export function parseDelivery(
  body: Record<string, unknown>,
  lotSize: number
): { accepted: number; rejected: number; reasons: string[]; pickupIds: string[] } | Response {
  const isZero = (v: unknown) => v === 0 || v === '0';
  const rejected =
    body.rejected == null || body.rejected === '' || isZero(body.rejected)
      ? 0
      : parseQuantity(body.rejected);
  if (rejected == null) return json({ error: 'Rejected must be a number' }, 400);

  let accepted: number | null;
  if (body.lots != null && !isZero(body.lots)) {
    const lots = parseQuantity(body.lots);
    accepted = lots == null ? null : parseQuantity(lotsToUnits(lots, lotSize));
  } else if (
    isZero(body.quantity) ||
    isZero(body.lots) ||
    (body.quantity == null && rejected > 0)
  ) {
    accepted = 0;
  } else {
    accepted = parseQuantity(body.quantity);
  }
  if (accepted == null) return json({ error: 'Enter how many were accepted' }, 400);
  if (accepted + rejected <= 0) return json({ error: 'Enter how many arrived' }, 400);

  const reasons = parseReasons(body.reasons);
  if (reasons == null) {
    return json({ error: `reasons must be a list of up to ${REASONS_MAX} reasons` }, 400);
  }
  if (rejected > 0 && reasons.length === 0) {
    return json({ error: 'Say why they were rejected' }, 400);
  }

  const rawIds = Array.isArray(body.pickupIds) ? body.pickupIds : [];
  if (rawIds.length > 50 || !rawIds.every(isUuid)) {
    return json({ error: 'pickupIds must be reject ids' }, 400);
  }
  return {
    accepted,
    rejected,
    reasons: rejected > 0 ? reasons : [],
    pickupIds: rawIds as string[],
  };
}
