// The shift-duty catalog (public.shift_duties) as the schedule reads it.
// Server-only: takes a service-role client.
//
// Nearly every schedule request needs it — validating an assignment, the
// weekly email, the calendar feed, the Shift SOPs block — and it only changes
// when an admin edits /admin/schedule/duties, so it's cached briefly per
// instance and dropped on every write through /api/admin/shift-duties. A
// failed read falls back to the built-in six rather than blanking every
// duty on the board.

import {
  DEFAULT_DUTY_CATALOG,
  type DutyCatalog,
  dutyDefFromRow,
  type ShiftDutyRow,
  sortCatalog,
} from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';

const TTL_MS = 30_000;
let cached: { at: number; catalog: DutyCatalog } | null = null;

type Row = ShiftDutyRow & { sops: { slug: string } | null };

/** Every duty, archived ones included, in canonical order. */
export async function loadDutyCatalog(db: SupabaseClient): Promise<DutyCatalog> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.catalog;
  const { data, error } = await db
    .from('shift_duties')
    .select(
      'key, label, detail, phase, side, session_default, sop_id, sort_order, archived, sops(slug)'
    );
  if (error) {
    console.error('[schedule] shift_duties read failed, using defaults:', error.message);
    return DEFAULT_DUTY_CATALOG;
  }
  const catalog = sortCatalog(
    ((data ?? []) as unknown as Row[]).map((row) => dutyDefFromRow(row, row.sops?.slug ?? null))
  );
  cached = { at: Date.now(), catalog };
  return catalog;
}

/** Drop the cached catalog so the next read sees an admin's edit. */
export function invalidateDutyCatalog(): void {
  cached = null;
}
