// The Monday shift roundup: every employee with locked-in hours in the week
// ahead gets one email listing their own shifts, each a deep link straight to
// that shift on /admin/schedule.
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
  formatDuties,
  utcToEastern,
  weekStartOf,
} from '@pyre/schedule-core';
import type { WeeklyShiftItem } from '@/emails/types';
import type { CronJobContext } from '@/lib/cron/jobs';
import {
  getDb,
  type ShiftAssignmentRow,
  type ShiftRow,
  type StaffRow,
  type SubRequestRow,
} from '@/lib/db';
import { sendTemplate } from '@/lib/email/send';
import { formatWindowLabel, todayEastern } from '@/lib/schedule/sub';

/** ET hour from which Monday's roundup may go out. */
const SEND_HOUR = 7;

/** Stop starting new sends with less than this left in the tick's budget. */
const TIME_FLOOR_MS = 5_000;

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

/** "Mon, Aug 17" — the compact per-row label (dates are ET wall-clock). */
export function formatDayLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
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

/** Same origin convention as the other email links: this app's deployment. */
function appOrigin(): string {
  return import.meta.env.PUBLIC_EMAIL_ASSET_BASE
    ? new URL(import.meta.env.PUBLIC_EMAIL_ASSET_BASE).origin
    : 'https://pyre-integrations.vercel.app';
}

const ROLE_LABELS: Record<ShiftAssignmentRow['role'], string | undefined> = {
  full: undefined,
  setup: 'setup',
  partial: 'partial hours',
};

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
  if (shifts.length === 0) return { ...base, skipped: 'no-shifts' };
  const shiftById = new Map(shifts.map((s) => [s.id, s]));

  const shiftIds = shifts.map((s) => s.id);
  const [assignmentRes, staffRes, subRes] = await Promise.all([
    db.from('shift_assignments').select('*').in('shift_id', shiftIds).eq('is_draft', false),
    db.from('staff').select('*'),
    db.from('sub_requests').select('*').in('shift_id', shiftIds).eq('status', 'open'),
  ]);
  if (assignmentRes.error) {
    return { ...base, skipped: `assignments-query-failed:${assignmentRes.error.message}` };
  }

  const assignments = (assignmentRes.data ?? []) as ShiftAssignmentRow[];
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

  const origin = appOrigin();
  const scheduleUrl = `${origin}/admin/schedule`;
  const weekLabel = formatWeekLabel(weekStart, weekEnd);
  const summary: WeeklyShiftsSummary = { ...base };
  const wouldSend: string[] = [];

  for (const person of staff) {
    const mine = byStaff.get(person.id) ?? [];
    if (mine.length === 0) {
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
      dayLabel: formatDayLabel(shift.shift_date),
      shiftLabel: shift.label,
      timeLabel: formatWindowLabel(assignment),
      shiftUrl: `${origin}/admin/schedule?view=week&date=${shift.shift_date}&shift=${shift.id}`,
      ...(ROLE_LABELS[assignment.role] && { roleLabel: ROLE_LABELS[assignment.role] }),
      // "Setup · Host" — what they're on the hook for, not just when.
      ...(formatDuties(assignment.duties) && {
        dutiesLabel: formatDuties(assignment.duties) as string,
      }),
      ...(shift.notes && { notes: shift.notes }),
      ...(pendingSubs.has(`${shift.id}:${person.id}`) && { subRequested: true }),
    }));

    const hours = items.reduce(
      (total, { assignment }) => total + assignmentHours(assignment.starts_at, assignment.ends_at),
      0
    );
    // Trim a trailing .0 so whole weeks read "18", not "18.0".
    const totalHours = String(Number(hours.toFixed(1)));

    const email = person.email as string;
    if (ctx.dryRun) {
      wouldSend.push(`${email} (${shiftItems.length} shifts, ${totalHours}h)`);
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
          totalHours,
          scheduleUrl,
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
