// Weekly labor cost from the shifts tables, shared math with
// /api/admin/schedule-insights (both lean on @pyre/schedule-core for the
// rollup — this module exists so /api/admin/business-overview can price
// weeks without duplicating the hour/rate/open-hour logic).
//
// Admin-only data: costs are built from every person's pay rate, so callers
// must sit behind requireAdmin.

import {
  amountsDue,
  founderIdsOf,
  openHoursByWeek,
  payRatesOf,
  rollupHours,
} from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ShiftAssignmentRow, ShiftRow, StaffRow } from '@/lib/db';

export interface WeeklyLabor {
  weekStart: string;
  /** Σ hours × each person's rate. */
  cost: number;
  /** Non-founder hours (founders draw no wage). */
  paidHours: number;
  /** Customer-facing hours: shift windows minus setup/shutdown padding. */
  openHours: number;
  /** cost ÷ openHours — the revenue/hour needed to break even on labor. */
  costPerOpenHour: number | null;
}

/** Weekly labor cost over [rangeStart, rangeEnd] (ET dates, any weeks). */
export async function computeWeeklyLabor(
  db: SupabaseClient,
  rangeStart: string,
  rangeEnd: string
): Promise<WeeklyLabor[]> {
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

  const rolled = rollupHours(
    assignments
      .filter((a) => activeShiftIds.has(a.shift_id))
      .map((assignment) => ({
        assignment,
        shiftDate: shiftById.get(assignment.shift_id)?.shift_date ?? '',
      }))
      .filter((r) => r.shiftDate !== ''),
    founderIdsOf(staff)
  );
  const rates = payRatesOf(staff);
  const openHours = openHoursByWeek(shifts);

  return rolled.map((week) => {
    const cost = amountsDue(week.byStaff, rates).total;
    const founderHours = (week.founderShare ?? 0) * week.total;
    const open = openHours[week.weekStart] ?? 0;
    return {
      weekStart: week.weekStart,
      cost,
      paidHours: Math.round((week.total - founderHours) * 10) / 10,
      openHours: Math.round(open * 10) / 10,
      costPerOpenHour: open > 0 ? Math.round((cost / open) * 100) / 100 : null,
    };
  });
}
