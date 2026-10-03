// Rejected deliveries over time: weekly delivered vs rejected for one item,
// and the reject rate. Pure and unit-tested; the /api/admin/inventory-rejects
// route supplies the rows. Weeks run Monday–Sunday on the studio's clock
// (America/New_York), so a Sunday-evening delivery lands in its own week.

import { STUDIO_TZ } from '@pyre/schedule-core';
import type { RejectWeek } from './types';

const DAY_MS = 86_400_000;

/** YYYY-MM-DD of an instant on the studio's clock. */
function studioDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: STUDIO_TZ });
}

/** The Monday (YYYY-MM-DD) of the studio week an instant falls in. */
export function weekStart(iso: string): string {
  const day = studioDate(iso);
  const noon = Date.parse(`${day}T12:00:00Z`);
  const weekday = new Date(noon).getUTCDay(); // 0 = Sunday
  const back = (weekday + 6) % 7; // days since Monday
  return new Date(noon - back * DAY_MS).toISOString().slice(0, 10);
}

/** Rejected ÷ delivered, as a percentage rounded to one decimal; null if nothing came. */
export function rejectRate(rejected: number, delivered: number): number | null {
  if (delivered <= 0) return null;
  return Math.round((rejected / delivered) * 1000) / 10;
}

/**
 * The last `weeks` studio weeks (oldest first, ending with the current one),
 * each with what was delivered (accepted receipts plus rejects) and what was
 * rejected. Weeks with no delivery are kept, at zero, so gaps show.
 */
export function weeklyRejects(
  receipts: readonly { occurred_at: string; quantity: number }[],
  rejects: readonly { received_at: string; rejected_qty: number; unit_cost_cents: number | null }[],
  weeks: number,
  now: Date
): RejectWeek[] {
  const current = weekStart(now.toISOString());
  const start = Date.parse(`${current}T12:00:00Z`);
  const out: RejectWeek[] = [];
  const byWeek = new Map<string, RejectWeek>();
  for (let i = weeks - 1; i >= 0; i--) {
    const week = new Date(start - i * 7 * DAY_MS).toISOString().slice(0, 10);
    const row = { week, delivered: 0, rejected: 0, rejectedCents: 0 };
    out.push(row);
    byWeek.set(week, row);
  }
  for (const r of receipts) {
    const row = byWeek.get(weekStart(r.occurred_at));
    if (row) row.delivered = Math.round((row.delivered + Number(r.quantity)) * 100) / 100;
  }
  for (const r of rejects) {
    const row = byWeek.get(weekStart(r.received_at));
    if (!row) continue;
    const qty = Number(r.rejected_qty);
    row.delivered = Math.round((row.delivered + qty) * 100) / 100;
    row.rejected = Math.round((row.rejected + qty) * 100) / 100;
    row.rejectedCents += r.unit_cost_cents == null ? 0 : Math.round(qty * r.unit_cost_cents);
  }
  return out;
}

/** What a reject is worth at its unit cost — the credit to ask for. */
export function rejectValueCents(r: {
  rejected_qty: number;
  unit_cost_cents: number | null;
}): number | null {
  return r.unit_cost_cents == null ? null : Math.round(Number(r.rejected_qty) * r.unit_cost_cents);
}
