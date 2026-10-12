// Who was on which shift on a day, so a note like "Sam and I stayed until
// 8:30" can become a shift_assignment.update on the right people's
// assignments. Live (not draft) shifts and assignments only: those are the
// hours the timesheet pays. Read-only.

import { getDb } from '../db';

interface ShiftRow {
  id: string;
  label: string;
  starts_at: string;
  ends_at: string;
}

interface AssignmentRow {
  id: string;
  shift_id: string;
  staff_id: string;
  starts_at: string;
  ends_at: string;
}

export async function findShiftAssignments(date: string) {
  const db = getDb();
  const { data: shiftData, error } = await db
    .from('shifts')
    .select('id, label, starts_at, ends_at')
    .eq('shift_date', date)
    .eq('status', 'active')
    .eq('is_draft', false)
    .order('starts_at');
  if (error) throw new Error(error.message);
  const shifts = (shiftData ?? []) as ShiftRow[];
  if (shifts.length === 0) return { date, shifts: [], note: 'No shifts on the schedule that day.' };

  const { data: assignmentData, error: assignmentError } = await db
    .from('shift_assignments')
    .select('id, shift_id, staff_id, starts_at, ends_at')
    .in(
      'shift_id',
      shifts.map((s) => s.id)
    )
    .eq('is_draft', false)
    .order('starts_at');
  if (assignmentError) throw new Error(assignmentError.message);
  const assignments = (assignmentData ?? []) as AssignmentRow[];

  const staffIds = [...new Set(assignments.map((a) => a.staff_id))];
  const { data: staffData } = staffIds.length
    ? await db.from('staff').select('id, display_name, email').in('id', staffIds)
    : { data: [] };
  const staff = new Map(
    (
      (staffData ?? []) as {
        id: string;
        display_name: string;
        email: string | null;
      }[]
    ).map((s) => [s.id, s])
  );

  return {
    date,
    shifts: shifts.map((shift) => ({
      shift: shift.label,
      window: `${shift.starts_at.slice(0, 5)}–${shift.ends_at.slice(0, 5)}`,
      crew: assignments
        .filter((a) => a.shift_id === shift.id)
        .map((a) => ({
          assignmentId: a.id,
          name: staff.get(a.staff_id)?.display_name ?? 'Unknown',
          email: staff.get(a.staff_id)?.email ?? null,
          startsAt: a.starts_at.slice(0, 5),
          endsAt: a.ends_at.slice(0, 5),
        })),
    })),
  };
}
