// The "next shift" chip on the /admin directory: the soonest shift still
// ahead of the ET clock — the viewer's own (staffId given), or the next one
// on the schedule regardless of who's on it (admins). Read-only; drafts and
// cancelled shifts never count. The chip is decorative, so every failure
// path returns null rather than surfacing an error on the admin home.

import type { LocalWallClock } from '@pyre/schedule-core';
import { DOW_LABELS, dayOfWeek, timeToMinutes, utcToEastern } from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ShiftAssignmentRow, ShiftRow } from '@/lib/db';

export interface NextShift {
  shift: ShiftRow;
  /** Non-draft assignments on the shift, in starts_at order. */
  assignments: ShiftAssignmentRow[];
  /** On today's ET date — the shift may already be in progress. */
  isToday: boolean;
}

/**
 * A shift stays "upcoming" until it ends: today's in-progress shift is the
 * one the viewer most needs to see.
 */
export function isUpcoming(
  shift: Pick<ShiftRow, 'shift_date' | 'ends_at'>,
  now: LocalWallClock
): boolean {
  if (shift.shift_date > now.date) return true;
  return shift.shift_date === now.date && timeToMinutes(shift.ends_at) > now.minutes;
}

// Plenty for the schedule's ~2-week commitment horizon plus any working plan
// beyond it; the ordered query means the first upcoming hit is the answer.
const CANDIDATE_LIMIT = 200;

/**
 * Next non-cancelled, non-draft shift on/after now (ET). With `staffId`, the
 * next shift that person is assigned to; without, the next shift overall.
 */
export async function getNextUpcomingShift(
  db: SupabaseClient,
  staffId?: string
): Promise<NextShift | null> {
  const now = utcToEastern(new Date().toISOString());

  const { data: shiftRows, error } = await db
    .from('shifts')
    .select('*')
    .eq('is_draft', false)
    .eq('status', 'active')
    .gte('shift_date', now.date)
    .order('shift_date')
    .order('starts_at')
    .limit(CANDIDATE_LIMIT);
  if (error) return null;

  // Today's already-ended shifts survive the date filter; drop them here.
  const candidates = ((shiftRows ?? []) as ShiftRow[]).filter((s) => isUpcoming(s, now));
  if (candidates.length === 0) return null;

  if (!staffId) {
    const shift = candidates[0];
    const { data: assignments, error: aError } = await db
      .from('shift_assignments')
      .select('*')
      .eq('shift_id', shift.id)
      .eq('is_draft', false)
      .order('starts_at');
    if (aError) return null;
    return {
      shift,
      assignments: (assignments ?? []) as ShiftAssignmentRow[],
      isToday: shift.shift_date === now.date,
    };
  }

  const { data: mine, error: mError } = await db
    .from('shift_assignments')
    .select('*')
    .eq('staff_id', staffId)
    .eq('is_draft', false)
    .in(
      'shift_id',
      candidates.map((s) => s.id)
    )
    .order('starts_at');
  if (mError) return null;

  const byShift = new Map<string, ShiftAssignmentRow[]>();
  for (const assignment of (mine ?? []) as ShiftAssignmentRow[]) {
    const list = byShift.get(assignment.shift_id) ?? [];
    list.push(assignment);
    byShift.set(assignment.shift_id, list);
  }
  const shift = candidates.find((s) => byShift.has(s.id));
  if (!shift) return null;
  return {
    shift,
    assignments: byShift.get(shift.id) ?? [],
    isToday: shift.shift_date === now.date,
  };
}

/** '16:00' → '4p', '09:30' → '9:30a' — same shorthand the calendar uses. */
export function formatChipTime(time: string): string {
  const min = timeToMinutes(time);
  const h = Math.floor(min / 60);
  const m = min % 60;
  const suffix = h < 12 ? 'a' : 'p';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, '0')}${suffix}`;
}

/** '2026-09-02' → 'Wed 9/2'. */
export function formatChipDate(date: string): string {
  return `${DOW_LABELS[dayOfWeek(date)]} ${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
}
