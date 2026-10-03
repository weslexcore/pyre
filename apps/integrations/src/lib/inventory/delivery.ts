// The receive form's delivery fields, shared by the stock screen's Receive
// (/api/admin/inventory-movements) and the Re-order tab's Received
// (/api/admin/inventory-orders). Server-only (returns ready 400 Responses).

import { isUuid, json } from '@/lib/http/json';
import { lotsToUnits, parseQuantity } from './rules';

const REASON_MAX = 120;

const text = (raw: unknown, max: number): string | null =>
  typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, max) : null;

/**
 * The receive form's delivery fields: accepted units (or whole lots), rejected
 * units with a reason, and the held rejects picked up with it. Shared with
 * the Re-order tab's receive (inventory-orders).
 */
export function parseDelivery(
  body: Record<string, unknown>,
  lotSize: number
): { accepted: number; rejected: number; reason: string | null; pickupIds: string[] } | Response {
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

  const reason = text(body.reason, REASON_MAX);
  if (rejected > 0 && !reason) return json({ error: 'Say why they were rejected' }, 400);

  const rawIds = Array.isArray(body.pickupIds) ? body.pickupIds : [];
  if (rawIds.length > 50 || !rawIds.every(isUuid)) {
    return json({ error: 'pickupIds must be reject ids' }, 400);
  }
  return {
    accepted,
    rejected,
    reason: rejected > 0 ? reason : null,
    pickupIds: rawIds as string[],
  };
}
