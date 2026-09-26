// The scheduler's entire world view, pre-computed: roster (with lead flags,
// weekly hour targets and shifts-per-week preferences), the target week's shifts (coverage windows
// already synced from Momence by the integrations cron), accepted
// assignments, pending shift requests, per-person availability for every
// shift, recent weekly hours and shift counts, and history patterns
// (including who usually holds which duties). All judgment-free math
// lives here (via @pyre/schedule-core) so the model only decides who works
// when.
//
// Exposed to the model only in scheduler sessions — see agent/tools/role_tools.ts.

import {
  availabilityFor,
  addDays,
  canLeadShift,
  DEFAULT_ARRIVE_BEFORE_MIN,
  DEFAULT_DUTY_CATALOG,
  DEFAULT_LEAVE_AFTER_MIN,
  defaultAssignmentWindow,
  type DutyDef,
  dutyDefFromRow,
  type ShiftDutyRow,
  sortCatalog,
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
    'Load everything needed to draft one week of the staffing schedule: roster (with lead flags, weekly hour targets and min/preferred/max shifts per week), shifts (coverage windows), accepted assignments, pending shift requests, availability per person per shift, recent weekly hours and shift counts, history patterns (including the duties each person usually holds), and the duty list (the only keys save_proposal accepts in `duties`). Call this first, before save_proposal.',
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
    // The rest rule reaches a day past the week on each side: Sunday before
    // into Monday, and Sunday into the Monday after.
    const dayBefore = addDays(weekStart, -1);
    const dayAfter = addDays(weekEnd, 1);

    const [staffRes, shiftsRes, timeOffRes, dutiesRes, bufferRes] = await Promise.all([
      db.from('staff').select('*').eq('active', true).order('display_name'),
      db
        .from('shifts')
        .select('*')
        .gte('shift_date', historyStart)
        .lte('shift_date', dayAfter)
        .eq('is_draft', false)
        .order('shift_date'),
      db.from('time_off').select('*'),
      // Admin-edited at /admin/schedule/duties; archived ones can't be assigned.
      db
        .from('shift_duties')
        .select('key, label, detail, phase, side, session_default, sop_id, sort_order, archived')
        .eq('archived', false),
      // When people arrive before the first session and leave after the last
      // (the board's schedule settings) — what an assignment without hours gets.
      db
        .from('schedule_settings')
        .select('key, minutes')
        .in('key', ['arrive_before_min', 'leave_after_min']),
    ]);
    for (const res of [staffRes, shiftsRes, timeOffRes]) {
      if (res.error) throw new Error(res.error.message);
    }

    const staff = (staffRes.data ?? []) as StaffRow[];
    const shifts = (shiftsRes.data ?? []) as ShiftRow[];
    const timeOff = (timeOffRes.data ?? []) as TimeOffRow[];
    // A failed read falls back to the built-in list rather than failing the draft.
    const duties: DutyDef[] = dutiesRes.error
      ? DEFAULT_DUTY_CATALOG.filter((d) => !d.archived)
      : sortCatalog(((dutiesRes.data ?? []) as ShiftDutyRow[]).map((r) => dutyDefFromRow(r, null)));

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
      (s) => s.shift_date >= weekStart && s.shift_date <= weekEnd && s.status === 'active'
    );
    const historyAssignments = assignments.filter((a) => {
      const shift = shiftById.get(a.shift_id);
      return shift !== undefined && shift.shift_date < weekStart;
    });
    const weekAssignments = assignments.filter((a) => {
      const shift = shiftById.get(a.shift_id);
      return shift !== undefined && shift.shift_date >= weekStart && shift.shift_date <= weekEnd;
    });
    const adjacentAssignments = assignments.filter((a) => {
      const shift = shiftById.get(a.shift_id);
      return (
        shift !== undefined &&
        shift.status === 'active' &&
        (shift.shift_date === dayBefore || shift.shift_date === dayAfter)
      );
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

    // A missing row (or a failed read) is the built-in default, as on the board.
    const bufferMinutes = new Map(
      ((bufferRes.data ?? []) as Array<{ key: string; minutes: number | null }>).map((r) => [
        r.key,
        r.minutes,
      ])
    );
    const buffers = {
      arriveBeforeMin: bufferMinutes.get('arrive_before_min') ?? DEFAULT_ARRIVE_BEFORE_MIN,
      leaveAfterMin: bufferMinutes.get('leave_after_min') ?? DEFAULT_LEAVE_AFTER_MIN,
    };

    // Availability matrix: person × week shift.
    const shiftsOut = weekShifts.map((shift) => ({
      shiftId: shift.id,
      date: shift.shift_date,
      label: shift.label,
      startsAt: shift.starts_at.slice(0, 5),
      endsAt: shift.ends_at.slice(0, 5),
      // The hours someone gets when an assignment leaves startsAt/endsAt out.
      defaultHours: defaultAssignmentWindow(shift, buffers),
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
    // Shifts per person per history week (one assignment = one shift), to
    // read beside the hours: the shifts-per-week preferences count these.
    const shiftsByWeek = new Map<string, Record<string, number>>();
    for (const a of historyAssignments) {
      const week = weekStartOf((shiftById.get(a.shift_id) as ShiftRow).shift_date);
      const counts = shiftsByWeek.get(week) ?? {};
      counts[a.staff_id] = (counts[a.staff_id] ?? 0) + 1;
      shiftsByWeek.set(week, counts);
    }
    const recentWeeklyHours = staff.map((person) => ({
      staffId: person.id,
      name: person.display_name,
      isFounder: person.is_founder,
      weekly: weeks.map((w) => ({
        weekStart: w.weekStart,
        hours: Math.round((w.byStaff[person.id] ?? 0) * 10) / 10,
        shifts: shiftsByWeek.get(w.weekStart)?.[person.id] ?? 0,
      })),
    }));

    // History patterns: per person, how often they worked each label/weekday
    // and how often they held each duty — the basis for proposing who does
    // what on the draft.
    const historyPatterns = staff.map((person) => {
      const theirs = historyAssignments.filter((a) => a.staff_id === person.id);
      const byLabel: Record<string, number> = {};
      const byWeekday: Record<string, number> = {};
      const byDuty: Record<string, number> = {};
      for (const a of theirs) {
        const shift = shiftById.get(a.shift_id) as ShiftRow;
        byLabel[shift.label] = (byLabel[shift.label] ?? 0) + 1;
        const weekday = new Date(`${shift.shift_date}T00:00:00Z`).getUTCDay();
        byWeekday[String(weekday)] = (byWeekday[String(weekday)] ?? 0) + 1;
        for (const duty of a.duties ?? []) byDuty[duty] = (byDuty[duty] ?? 0) + 1;
      }
      return { staffId: person.id, name: person.display_name, byLabel, byWeekday, byDuty };
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
        // Shifts this week, counting existingAssignments: aim at preferred,
        // reach min where you can; max is a hard cap the server enforces.
        minShiftsPerWeek: s.min_shifts_per_week,
        preferredShiftsPerWeek: s.preferred_shifts_per_week,
        maxShiftsPerWeek: s.max_shifts_per_week,
      })),
      shifts: shiftsOut,
      pendingShiftRequests: pendingRequests.map((r) => ({
        shiftId: r.shift_id,
        staffId: r.staff_id,
        // The hours they asked to work; null on legacy requests (then the
        // shift's defaultHours).
        requestedStartsAt: r.requested_starts_at?.slice(0, 5) ?? null,
        requestedEndsAt: r.requested_ends_at?.slice(0, 5) ?? null,
        note: r.note,
      })),
      existingAssignments: weekAssignments.map((a) => ({
        shiftId: a.shift_id,
        staffId: a.staff_id,
        startsAt: a.starts_at.slice(0, 5),
        endsAt: a.ends_at.slice(0, 5),
        // Jobs already spoken for on this shift, so a draft doesn't hand the
        // same one to two people.
        duties: a.duties,
      })),
      // Live assignments the day before and after the week, for the rest
      // rule: an evening close on the Sunday before rules out a Monday open,
      // and a Sunday close in this week rules out opening the Monday after.
      adjacentAssignments: adjacentAssignments.map((a) => {
        const shift = shiftById.get(a.shift_id) as ShiftRow;
        return {
          date: shift.shift_date,
          staffId: a.staff_id,
          startsAt: a.starts_at.slice(0, 5),
          endsAt: a.ends_at.slice(0, 5),
        };
      }),
      recentWeeklyHours,
      historyPatterns,
      // The jobs an assignment can hold, in shift order. `side` pairs set-up
      // and break-down halves (whoever takes A at set-up takes A at break
      // down); `sessionDefault` is the in-session duty that half usually takes.
      duties: duties.map((d) => ({
        key: d.key,
        label: d.label,
        detail: d.detail,
        phase: d.phase,
        side: d.side,
        sessionDefault: d.sessionDefault,
      })),
    };
  },
});
