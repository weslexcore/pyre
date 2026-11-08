// The Monday shift roundup: every employee with locked-in hours in the week
// ahead gets one email listing their own shifts, each a deep link straight to
// that shift on /admin/schedule. Off-shift duties they're down for (fill the
// carboys Monday) are listed beneath, so someone with only those still hears.
// Their time off closes the email: what they've logged inside the window the
// schedule is set for, then the two weeks after it — the weeks that get
// scheduled next — with a button to the Availability tab, so anything they
// haven't logged yet lands before those weeks lock.
//
// "Locked in" means live rows — is_draft = false on both the shift and the
// assignment, so an agent proposal still awaiting review is never mailed out
// as if it were settled, and cancelled shifts drop off.
//
// Cadence: the tick is hourly, so this job gates on "it's Monday in ET and
// past SEND_HOUR" and leans on the per-recipient send_key for exactness — the
// claim is what makes it once-per-person-per-week, not the clock. That also
// means a missed 7am tick self-heals on the 8am one, and somebody staffed
// later on Monday still gets their email on the next tick.

import {
  addDays,
  assignmentHours,
  busyIntervalOn,
  DOW_LABELS,
  type DutyAssignmentRow,
  dutyDef,
  firstTentativeDate,
  formatCompactTime,
  formatDuties,
  formatShortDay,
  type TimeOffRow,
  todayEastern,
  utcToEastern,
  weekStartOf,
} from '@pyre/schedule-core';
import type {
  WeeklyDutyItem,
  WeeklyShiftItem,
  WeeklyTimeOffItem,
  WeeklyTimeOffWindow,
} from '@/emails/types';
import type { CronJobContext } from '@/lib/cron/jobs';
import {
  getDb,
  type ShiftAssignmentRow,
  type ShiftRow,
  type StaffRow,
  type SubRequestRow,
} from '@/lib/db';
import { sendTemplate } from '@/lib/email/send';
import { appOrigin } from '@/lib/origins';
import { loadDutyCatalog } from '@/lib/schedule/duties';
import { getConfirmedHorizonDays } from '@/lib/schedule/settings';
import { formatWindowLabel } from '@/lib/schedule/sub';

/** ET hour from which Monday's roundup may go out. */
const SEND_HOUR = 7;

/** Stop starting new sends with less than this left in the tick's budget. */
const TIME_FLOOR_MS = 5_000;

/**
 * How far past the commitment horizon the time-off section looks: the two
 * weeks that get scheduled next, so the ask to log time off lands while it
 * can still shape those weeks.
 */
const UPCOMING_DAYS = 14;

export interface WeeklyShiftsSummary {
  weekStart: string;
  sent: number;
  /** Recipients whose email was already claimed for this week. */
  duplicates: number;
  /** Roster members with no locked-in hours this week — not emailed. */
  withoutShifts: number;
  failed: string[];
  skipped?: string;
  outOfTime?: boolean;
  wouldSend?: string[];
}

/** "Aug 17–23", collapsing the month when the week doesn't straddle one. */
export function formatWeekLabel(start: string, end: string): string {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  const startLabel = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endLabel = endDate.toLocaleDateString('en-US', {
    month: startDate.getMonth() === endDate.getMonth() ? undefined : 'short',
    day: 'numeric',
  });
  return `${startLabel}–${endLabel}`;
}

/** First date in [from, to] on which the entry makes the person busy, or null. */
function firstDateIn(entry: TimeOffRow, from: string, to: string): string | null {
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (busyIntervalOn(entry, date)) return date;
  }
  return null;
}

/** "Fri, Nov 20 – Sun, Nov 22", "Fri, Nov 20", or "Every Tue/Thu (through Sun, Nov 30)". */
function formatTimeOffWhen(entry: TimeOffRow): string {
  if (entry.kind === 'range') {
    const start = entry.start_date ?? '';
    const end = entry.end_date ?? start;
    return start === end
      ? formatShortDay(start)
      : `${formatShortDay(start)} – ${formatShortDay(end)}`;
  }
  const days = [...entry.days_of_week]
    .sort((a, b) => a - b)
    .map((d) => DOW_LABELS[d] ?? String(d))
    .join('/');
  return entry.end_date
    ? `Every ${days} (through ${formatShortDay(entry.end_date)})`
    : `Every ${days}`;
}

/** One entry as the email shows it. */
export function timeOffItem(entry: TimeOffRow): WeeklyTimeOffItem {
  return {
    whenLabel: formatTimeOffWhen(entry),
    timeLabel:
      entry.starts_at && entry.ends_at
        ? `${formatCompactTime(entry.starts_at)}–${formatCompactTime(entry.ends_at)}`
        : 'All day',
    ...(entry.note && { note: entry.note }),
  };
}

/**
 * The entries that put the person out on at least one day of [from, to], in
 * the order they first apply. A trip that straddles the boundary between two
 * windows shows in both — each window reads complete on its own.
 */
export function timeOffWindow(
  entries: TimeOffRow[],
  from: string,
  to: string
): WeeklyTimeOffWindow {
  const items = entries
    .map((entry) => ({ entry, first: firstDateIn(entry, from, to) }))
    .filter((row): row is { entry: TimeOffRow; first: string } => row.first != null)
    .sort(
      (x, y) =>
        x.first.localeCompare(y.first) || x.entry.created_at.localeCompare(y.entry.created_at)
    )
    .map(({ entry }) => timeOffItem(entry));
  return { rangeLabel: formatWeekLabel(from, to), items };
}

export async function runWeeklyShiftEmails(ctx: CronJobContext): Promise<WeeklyShiftsSummary> {
  const today = todayEastern();
  const weekStart = weekStartOf(today);
  const weekEnd = addDays(weekStart, 6);
  const base: WeeklyShiftsSummary = {
    weekStart,
    sent: 0,
    duplicates: 0,
    withoutShifts: 0,
    failed: [],
  };

  // Monday, after the send hour, in ET. getDay() on a midnight-local parse is
  // weekday-safe regardless of the server's timezone.
  const isMonday = new Date(`${today}T00:00:00`).getDay() === 1;
  const { minutes } = utcToEastern(new Date().toISOString());
  if (!isMonday) return { ...base, skipped: 'not-monday' };
  if (minutes < SEND_HOUR * 60) return { ...base, skipped: 'before-send-hour' };

  const db = getDb();
  if (!db) return { ...base, skipped: 'db-unavailable' };

  // Live shifts in the week, then the live assignments on them. Draft rows
  // belong to an unapproved proposal and are not anyone's schedule yet.
  const { data: shiftRows, error: shiftError } = await db
    .from('shifts')
    .select('*')
    .gte('shift_date', weekStart)
    .lte('shift_date', weekEnd)
    .eq('is_draft', false)
    .eq('status', 'active');
  if (shiftError) return { ...base, skipped: `shifts-query-failed:${shiftError.message}` };

  const shifts = (shiftRows ?? []) as ShiftRow[];
  const { data: dutyRows, error: dutyError } = await db
    .from('duty_assignments')
    .select('*')
    .gte('duty_date', weekStart)
    .lte('duty_date', weekEnd)
    .eq('is_draft', false);
  if (dutyError) return { ...base, skipped: `duty-assignments-query-failed:${dutyError.message}` };
  const dutyAssignments = (dutyRows ?? []) as DutyAssignmentRow[];
  if (shifts.length === 0 && dutyAssignments.length === 0) {
    return { ...base, skipped: 'no-shifts' };
  }
  const shiftById = new Map(shifts.map((s) => [s.id, s]));

  const shiftIds = shifts.map((s) => s.id);
  const [assignmentRes, staffRes, subRes, timeOffRes, horizonDays] = await Promise.all([
    shiftIds.length > 0
      ? db.from('shift_assignments').select('*').in('shift_id', shiftIds).eq('is_draft', false)
      : Promise.resolve({ data: [], error: null }),
    db.from('staff').select('*'),
    shiftIds.length > 0
      ? db.from('sub_requests').select('*').in('shift_id', shiftIds).eq('status', 'open')
      : Promise.resolve({ data: [], error: null }),
    // Every entry, filtered per window below: a recurring rule has no dates to
    // range-query on, and the table is small.
    db.from('time_off').select('*'),
    getConfirmedHorizonDays(),
  ]);
  if (assignmentRes.error) {
    return { ...base, skipped: `assignments-query-failed:${assignmentRes.error.message}` };
  }
  if (timeOffRes.error) {
    return { ...base, skipped: `time-off-query-failed:${timeOffRes.error.message}` };
  }

  const assignments = (assignmentRes.data ?? []) as ShiftAssignmentRow[];
  const dutyCatalog = await loadDutyCatalog(db);
  const staff = ((staffRes.data ?? []) as StaffRow[]).filter((s) => s.active && s.email);
  // An open sub request means the shift is still theirs, but flagged — the
  // roundup says so rather than pretending it's settled.
  const pendingSubs = new Set(
    ((subRes.data ?? []) as SubRequestRow[]).map((r) => `${r.shift_id}:${r.requester_staff_id}`)
  );

  const byStaff = new Map<string, ShiftAssignmentRow[]>();
  for (const a of assignments) {
    const list = byStaff.get(a.staff_id);
    if (list) list.push(a);
    else byStaff.set(a.staff_id, [a]);
  }
  const dutiesByStaff = new Map<string, DutyAssignmentRow[]>();
  for (const d of [...dutyAssignments].sort((x, y) => x.duty_date.localeCompare(y.duty_date))) {
    dutiesByStaff.set(d.staff_id, [...(dutiesByStaff.get(d.staff_id) ?? []), d]);
  }
  const timeOffByStaff = new Map<string, TimeOffRow[]>();
  for (const t of (timeOffRes.data ?? []) as TimeOffRow[]) {
    timeOffByStaff.set(t.staff_id, [...(timeOffByStaff.get(t.staff_id) ?? []), t]);
  }

  // The set window runs from this Monday to the last confirmed date; the
  // upcoming one is the two weeks after that, which get scheduled next.
  const upcomingStart = firstTentativeDate(today, horizonDays);
  const confirmedEnd = addDays(upcomingStart, -1);
  const upcomingEnd = addDays(upcomingStart, UPCOMING_DAYS - 1);

  const origin = appOrigin();
  const scheduleUrl = `${origin}/admin/schedule`;
  const availabilityUrl = `${origin}/admin/schedule/availability`;
  const weekLabel = formatWeekLabel(weekStart, weekEnd);
  const summary: WeeklyShiftsSummary = { ...base };
  const wouldSend: string[] = [];

  for (const person of staff) {
    const mine = byStaff.get(person.id) ?? [];
    const myDuties = dutiesByStaff.get(person.id) ?? [];
    const myTimeOff = timeOffByStaff.get(person.id) ?? [];
    if (mine.length === 0 && myDuties.length === 0) {
      summary.withoutShifts += 1;
      continue;
    }

    if (ctx.timeRemainingMs() < TIME_FLOOR_MS) {
      // No cursor needed: the send_key claims already recorded make the next
      // tick pick up exactly where this one stopped.
      summary.outOfTime = true;
      break;
    }

    const items = mine
      .map((a) => ({ assignment: a, shift: shiftById.get(a.shift_id) }))
      .filter(
        (row): row is { assignment: ShiftAssignmentRow; shift: ShiftRow } => row.shift != null
      )
      .sort((x, y) =>
        x.shift.shift_date === y.shift.shift_date
          ? x.assignment.starts_at.localeCompare(y.assignment.starts_at)
          : x.shift.shift_date.localeCompare(y.shift.shift_date)
      );

    const shiftItems: WeeklyShiftItem[] = items.map(({ assignment, shift }) => ({
      dayLabel: formatShortDay(shift.shift_date),
      shiftLabel: shift.label,
      timeLabel: formatWindowLabel(assignment),
      shiftUrl: `${origin}/admin/schedule?view=week&date=${shift.shift_date}&shift=${shift.id}`,
      // "Setup · Host" — what they're on the hook for, not just when.
      ...(formatDuties(dutyCatalog, assignment.duties) && {
        dutiesLabel: formatDuties(dutyCatalog, assignment.duties) as string,
      }),
      ...(shift.notes && { notes: shift.notes }),
      ...(pendingSubs.has(`${shift.id}:${person.id}`) && { subRequested: true }),
    }));

    const dutyItems: WeeklyDutyItem[] = myDuties.map((d) => {
      const def = dutyDef(dutyCatalog, d.duty_key);
      return {
        dayLabel: formatShortDay(d.duty_date),
        dutyLabel: def?.label ?? d.duty_key,
        ...(def?.detail && { detail: def.detail }),
        dayUrl: `${origin}/admin/schedule?view=week&date=${d.duty_date}`,
      };
    });

    const hours = items.reduce(
      (total, { assignment }) => total + assignmentHours(assignment.starts_at, assignment.ends_at),
      0
    );
    // Trim a trailing .0 so whole weeks read "18", not "18.0".
    const totalHours = String(Number(hours.toFixed(1)));

    const email = person.email as string;
    if (ctx.dryRun) {
      wouldSend.push(
        `${email} (${shiftItems.length} shifts, ${totalHours}h${
          dutyItems.length > 0 ? `, ${dutyItems.length} off-shift duties` : ''
        })`
      );
      continue;
    }

    // Per-recipient key: a key of just the week would let the first person
    // claim it and leave everyone else silently skipped as already-sent.
    try {
      const result = await sendTemplate({
        to: email,
        template: 'weekly-shifts',
        props: {
          firstName: person.display_name,
          weekLabel,
          shifts: shiftItems,
          ...(dutyItems.length > 0 && { offShiftDuties: dutyItems }),
          totalHours,
          scheduleUrl,
          timeOff: {
            confirmed: timeOffWindow(myTimeOff, weekStart, confirmedEnd),
            upcoming: timeOffWindow(myTimeOff, upcomingStart, upcomingEnd),
          },
          availabilityUrl,
        },
        kind: 'transactional',
        sendKey: `weekly-shifts:${weekStart}:${email}`,
      });
      if (result.status === 'sent') summary.sent += 1;
      else if (result.reason === 'already-sent') summary.duplicates += 1;
    } catch (e) {
      console.error(`[weekly-shifts] send to ${email} failed:`, e instanceof Error ? e.message : e);
      summary.failed.push(email);
    }
  }

  return ctx.dryRun ? { ...summary, wouldSend } : summary;
}
