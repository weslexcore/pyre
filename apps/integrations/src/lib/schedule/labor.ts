// Daily labor cost from the shifts tables, shared math with
// /api/admin/schedule-insights (both lean on @pyre/schedule-core for the
// rollup — this module exists so /api/admin/business-overview can price
// arbitrary date ranges without duplicating the hour/rate/open-hour logic).
// One row per ET day; the API re-buckets into day/week/month at read time.
//
// Admin-only data: costs are built from every person's pay rate, so callers
// must sit behind requireAdmin.

import {
  amountsDue,
  founderIdsOf,
  openHoursByDay,
  payRatesOf,
  rollupHours,
} from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ShiftAssignmentRow, ShiftRow, StaffRow } from '@/lib/db';

export interface DailyLabor {
  /** ET calendar day, YYYY-MM-DD. */
  date: string;
  /** Σ hours × each person's rate. */
  cost: number;
  /** Non-founder hours (founders draw no wage). */
  paidHours: number;
  /** Customer-facing hours: shift windows minus setup/shutdown padding. */
  openHours: number;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Per-day labor cost over [rangeStart, rangeEnd] (ET dates). Days with no
 * shifts are omitted, not zero-filled. */
export async function computeDailyLabor(
  db: SupabaseClient,
  rangeStart: string,
  rangeEnd: string
): Promise<DailyLabor[]> {
  const [staffRes, shiftsRes] = await Promise.all([
    db.from('staff').select('*'),
    db
      .from('shifts')
      .select('*')
      .gte('shift_date', rangeStart)
      .lte('shift_date', rangeEnd)
      .eq('is_draft', false)
      .order('shift_date'),
  ]);
  const queryError = staffRes.error ?? shiftsRes.error;
  if (queryError) throw new Error(queryError.message);

  const staff = (staffRes.data ?? []) as StaffRow[];
  const shifts = (shiftsRes.data ?? []) as ShiftRow[];
  if (shifts.length === 0) return [];

  const shiftIds = shifts.map((s) => s.id);
  const { data: assignmentRows, error: assignmentError } = await db
    .from('shift_assignments')
    .select('*')
    .in('shift_id', shiftIds)
    .eq('is_draft', false);
  if (assignmentError) throw new Error(assignmentError.message);
  const assignments = (assignmentRows ?? []) as ShiftAssignmentRow[];

  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const activeShiftIds = new Set(shifts.filter((s) => s.status === 'active').map((s) => s.id));

  const founderIds = founderIdsOf(staff);
  const rolled = rollupHours(
    assignments
      .filter((a) => activeShiftIds.has(a.shift_id))
      .map((assignment) => ({
        assignment,
        shiftDate: shiftById.get(assignment.shift_id)?.shift_date ?? '',
      }))
      .filter((r) => r.shiftDate !== ''),
    founderIds
  );
  const rates = payRatesOf(staff);
  const openHours = openHoursByDay(shifts);

  const byDate = new Map<string, DailyLabor>();
  for (const week of rolled) {
    for (const day of week.days) {
      const founderHours = Object.entries(day.byStaff)
        .filter(([staffId]) => founderIds.has(staffId))
        .reduce((sum, [, hours]) => sum + hours, 0);
      byDate.set(day.date, {
        date: day.date,
        cost: amountsDue(day.byStaff, rates).total,
        paidHours: round1(day.total - founderHours),
        openHours: 0,
      });
    }
  }
  // Days that were open but had no (active, non-draft) assignments still
  // count their customer-facing hours.
  for (const [date, open] of Object.entries(openHours)) {
    const row = byDate.get(date) ?? { date, cost: 0, paidHours: 0, openHours: 0 };
    row.openHours = round1(open);
    byDate.set(date, row);
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
