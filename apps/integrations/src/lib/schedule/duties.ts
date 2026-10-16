// The shift-duty catalog (public.shift_duties) as the schedule reads it.
// Server-only: takes a service-role client.
//
// Nearly every schedule request needs it — validating an assignment, the
// weekly email, the calendar feed, the Shift SOPs block — and it only changes
// when an admin edits /admin/schedule/duties, so it's cached briefly per
// instance and dropped on every write through /api/admin/shift-duties. A
// failed read falls back to the built-in six rather than blanking every
// duty on the board.
//
// Who is trained on which duty (public.staff_duty_training) is read and
// cached the same way, dropped on every write through
// /api/admin/duty-training. A failed read is an error, not "nobody is
// trained" — the callers enforcing it refuse rather than guess.

import {
  DEFAULT_DUTY_CATALOG,
  type DutyCatalog,
  type DutyTraining,
  type DutyTrainingRow,
  dutyDefFromRow,
  type ShiftDutyRow,
  sortCatalog,
  trainingFromRows,
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
      'key, label, detail, phase, side, session_default, sop_id, days, sort_order, requires_training, archived, sops(slug)'
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

let cachedTraining: { at: number; rows: DutyTrainingRow[] } | null = null;

/** Every staff_duty_training row; throws when the table can't be read. */
export async function loadDutyTrainingRows(db: SupabaseClient): Promise<DutyTrainingRow[]> {
  if (cachedTraining && Date.now() - cachedTraining.at < TTL_MS) return cachedTraining.rows;
  const { data, error } = await db
    .from('staff_duty_training')
    .select('staff_id, duty_key, trained_by, created_at');
  if (error) throw new Error(`staff_duty_training read failed: ${error.message}`);
  const rows = (data ?? []) as DutyTrainingRow[];
  cachedTraining = { at: Date.now(), rows };
  return rows;
}

/** Who is trained on what, keyed by duty. Throws when it can't be read. */
export async function loadDutyTraining(db: SupabaseClient): Promise<DutyTraining> {
  return trainingFromRows(await loadDutyTrainingRows(db));
}

/** Drop the cached training list so the next read sees a manager's edit. */
export function invalidateDutyTraining(): void {
  cachedTraining = null;
}
