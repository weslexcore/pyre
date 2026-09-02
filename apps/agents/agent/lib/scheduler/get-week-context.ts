// The scheduler's entire world view, pre-computed: roster (with lead flags
// and weekly hour targets), the target week's shifts (coverage windows
// already synced from Momence by the integrations cron), accepted
// assignments, pending shift requests, per-person availability for every
// shift, recent weekly hours, and history patterns. All judgment-free math
// lives here (via @pyre/schedule-core) so the model only decides who works
// when.
//
// Exposed to the model only in scheduler sessions — see agent/tools/role_tools.ts.

import {
  availabilityFor,
  addDays,
  canLeadShift,
  rollupHours,
  type StaffRow,
  type ShiftAssignmentRow,
  type ShiftRequestRow,
  type ShiftRow,
  type TimeOffRow,
  timeToMinutes,
  utcToEastern,
  weekStartOf,
} from '@pyre/schedule-core';
import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { getDb } from '../db';

const HISTORY_WEEKS = 8;

export const getWeekContextTool = defineTool({
  description:
    'Load everything needed to draft one week of the staffing schedule: roster (with lead flags and weekly hour targets), shifts (coverage windows), accepted assignments, pending shift requests, availability per person per shift, recent weekly hours, and history patterns. Call this first, before save_proposal.',
  inputSchema: z.object({
    weekStart: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe('Monday of the week to draft (YYYY-MM-DD). Defaults to next week.'),
  }),
  async execute({ weekStart: requestedWeekStart }) {
    const db = getDb();

    const todayEastern = utcToEastern(new Date().toISOString()).date;
    const weekStart = requestedWeekStart
      ? weekStartOf(requestedWeekStart)
      : addDays(weekStartOf(todayEastern), 7);
    const weekEnd = addDays(weekStart, 6);
    const historyStart = addDays(weekStart, -7 * HISTORY_WEEKS);

    const [staffRes, shiftsRes, timeOffRes] = await Promise.all([
      db.from('staff').select('*').eq('active', true).order('display_name'),
      db
        .from('shifts')
        .select('*')
        .gte('shift_date', historyStart)
        .lte('shift_date', weekEnd)
        .eq('is_draft', false)
        .order('shift_date'),
      db.from('time_off').select('*'),
    ]);
    for (const res of [staffRes, shiftsRes, timeOffRes]) {
      if (res.error) throw new Error(res.error.message);
    }

    const staff = (staffRes.data ?? []) as StaffRow[];
    const shifts = (shiftsRes.data ?? []) as ShiftRow[];
    const timeOff = (timeOffRes.data ?? []) as TimeOffRow[];

    const shiftIds = shifts.map((s) => s.id);
    let assignments: ShiftAssignmentRow[] = [];
    if (shiftIds.length > 0) {
      const { data, error } = await db
        .from('shift_assignments')
        .select('*')
        .in('shift_id', shiftIds)
        .eq('is_draft', false);
      if (error) throw new Error(error.message);
      assignments = (data ?? []) as ShiftAssignmentRow[];
    }

    const shiftById = new Map(shifts.map((s) => [s.id, s]));
    const weekShifts = shifts.filter(
      (s) => s.shift_date >= weekStart && s.status === 'active'
    );
    const historyAssignments = assignments.filter((a) => {
      const shift = shiftById.get(a.shift_id);
      return shift !== undefined && shift.shift_date < weekStart;
    });
    const weekAssignments = assignments.filter((a) => {
      const shift = shiftById.get(a.shift_id);
      return shift !== undefined && shift.shift_date >= weekStart;
    });

    // Pending shift requests on the week's shifts: people who asked to work
    // a shift and are still waiting on a decision.
    let pendingRequests: ShiftRequestRow[] = [];
    if (weekShifts.length > 0) {
      const { data, error } = await db
        .from('shift_requests')
        .select('*')
        .in(
          'shift_id',
          weekShifts.map((s) => s.id)
        )
        .eq('status', 'pending');
      if (error) throw new Error(error.message);
      pendingRequests = (data ?? []) as ShiftRequestRow[];
    }

    // Availability matrix: person × week shift.
    const shiftsOut = weekShifts.map((shift) => ({
      shiftId: shift.id,
      date: shift.shift_date,
      label: shift.label,
      startsAt: shift.starts_at.slice(0, 5),
      endsAt: shift.ends_at.slice(0, 5),
      staffNeeded: shift.staff_needed,
      notes: shift.notes,
      syncFlag: shift.sync_flag,
      availability: Object.fromEntries(
        staff.map((person) => {
          const result = availabilityFor(
            timeOff,
            person.id,
            shift.shift_date,
            timeToMinutes(shift.starts_at),
            timeToMinutes(shift.ends_at)
          );
          return [
            person.id,
            {
              status: result.status,
              reasons: result.conflicts.map((c) => c.note || 'time off'),
            },
          ];
        })
      ),
    }));

    // Recent weekly hours (trailing history weeks, founders marked).
    const founderIds = new Set(staff.filter((s) => s.is_founder).map((s) => s.id));
    const weeks = rollupHours(
      historyAssignments.map((assignment) => ({
        assignment,
        shiftDate: (shiftById.get(assignment.shift_id) as ShiftRow).shift_date,
      })),
      founderIds
    );
    const recentWeeklyHours = staff.map((person) => ({
      staffId: person.id,
      name: person.display_name,
      isFounder: person.is_founder,
      weekly: weeks.map((w) => ({
        weekStart: w.weekStart,
        hours: Math.round((w.byStaff[person.id] ?? 0) * 10) / 10,
      })),
    }));

    // History patterns: per person, how often they worked each label/weekday
    // and how often their assignments were setup vs full.
    const historyPatterns = staff.map((person) => {
      const theirs = historyAssignments.filter((a) => a.staff_id === person.id);
      const byLabel: Record<string, number> = {};
      const byWeekday: Record<string, number> = {};
      const byRole: Record<string, number> = {};
      for (const a of theirs) {
        const shift = shiftById.get(a.shift_id) as ShiftRow;
        byLabel[shift.label] = (byLabel[shift.label] ?? 0) + 1;
        const weekday = new Date(`${shift.shift_date}T00:00:00Z`).getUTCDay();
        byWeekday[String(weekday)] = (byWeekday[String(weekday)] ?? 0) + 1;
        byRole[a.role] = (byRole[a.role] ?? 0) + 1;
      }
      return { staffId: person.id, name: person.display_name, byLabel, byWeekday, byRole };
    });

    return {
      weekStart,
      weekEnd,
      staff: staff.map((s) => ({
        staffId: s.id,
        name: s.display_name,
        isFounder: s.is_founder,
        canLead: canLeadShift(s),
        targetHoursPerWeek: s.target_hours_per_week,
      })),
      shifts: shiftsOut,
      pendingShiftRequests: pendingRequests.map((r) => ({
        shiftId: r.shift_id,
        staffId: r.staff_id,
        role: r.role,
        // The hours they asked to work; null on legacy requests (then the
        // role implies the window: full shift, or its setup span).
        requestedStartsAt: r.requested_starts_at?.slice(0, 5) ?? null,
        requestedEndsAt: r.requested_ends_at?.slice(0, 5) ?? null,
        note: r.note,
      })),
      existingAssignments: weekAssignments.map((a) => ({
        shiftId: a.shift_id,
        staffId: a.staff_id,
        startsAt: a.starts_at.slice(0, 5),
        endsAt: a.ends_at.slice(0, 5),
        role: a.role,
      })),
      recentWeeklyHours,
      historyPatterns,
    };
  },
});
