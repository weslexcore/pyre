// Momence → shifts sync: pulls upcoming sessions and private appointments,
// derives coverage windows (schedule-core), and reconciles them with the
// shifts table. Deterministic and idempotent — the judgment-free half of the
// scheduling agent. Runs hourly from the cron registry and inline from the
// admin "Sync Momence" / "Draft schedule" endpoints.
//
// Reconciliation rules (see docs/staff-scheduling-scope.md): unlocked +
// unassigned shifts track Momence silently (update/cancel); anything staffed
// or sync_locked only ever gets flagged for the admin — sessions get deleted
// to be replaced, or weather-cancelled, and nobody should be silently
// unassigned because of it.
//
// Head counts come from the admins' staffing rules (staffing-rules.ts):
// every window gets the first matching rule's count, new shifts are created
// with it, and tracked shifts are moved to it unless an admin set theirs by
// hand. Rules can match on Momence tags, which only the public events feed
// carries — if that feed or the rules can't be read, existing counts stay put.

import {
  type CoverageEvent,
  deriveCoverageWindows,
  minutesToTime,
  notesForTitles,
  planShiftSync,
  type SyncShiftInput,
  staffNeededFor,
  syncRange,
  timeToMinutes,
  utcToEastern,
} from '@pyre/schedule-core';
import { getDb } from '@/lib/db';
import { fetchAppointmentReservations, fetchHostSessions } from '@/lib/momence/host-api';
import { fetchMomenceEvents } from '@/lib/momence-events';
import { assigneesOf, notifyShiftChange } from '@/lib/notifications/schedule';
import { type ChangeActor, logScheduleChange, SYNC_ACTOR } from '@/lib/schedule/change-log';
import { loadStaffingRules } from '@/lib/schedule/staffing-rules';

const DAY_MIN = 24 * 60;
const DEFAULT_HORIZON_DAYS = 21;
/** Fallback duration when Momence omits an appointment end time. */
const APPOINTMENT_FALLBACK_MIN = 60;

export interface SyncShiftsSummary {
  dryRun: boolean;
  horizonDays: number;
  lookbackDays: number;
  events: number;
  windows: number;
  created: number;
  updated: number;
  cancelled: number;
  flagged: number;
  flagsCleared: number;
  /** Tracked shifts whose head count the staffing rules changed. */
  staffingUpdated: number;
}

/**
 * Normalize a Momence UTC start/end pair to a local-wall-clock event on the
 * start's calendar day; an event running past local midnight clamps to 24:00
 * (overnight coverage isn't a thing at Pyre — the close buffer covers it).
 */
function toEvent(
  kind: CoverageEvent['kind'],
  id: number,
  title: string,
  startsAt: string,
  endsAt: string | null,
  tags: string[] = []
): CoverageEvent | null {
  if (!startsAt) return null;
  const start = utcToEastern(startsAt);
  let endMin: number;
  if (endsAt) {
    const end = utcToEastern(endsAt);
    endMin = end.date === start.date ? end.minutes : DAY_MIN;
  } else {
    endMin = Math.min(start.minutes + APPOINTMENT_FALLBACK_MIN, DAY_MIN);
  }
  if (endMin <= start.minutes) return null;
  return { kind, id, title, date: start.date, startMin: start.minutes, endMin, tags };
}

export async function syncShifts(
  // `actor` attributes the run in the schedule change log; the default is the
  // hourly cron's system actor, admin triggers pass the clicking user.
  // `lookbackDays` also reconciles that many past days, so an admin run can
  // repair rows an earlier run got wrong; the cron leaves it at 0.
  options: {
    dryRun?: boolean;
    horizonDays?: number;
    lookbackDays?: number;
    actor?: ChangeActor;
  } = {}
): Promise<SyncShiftsSummary> {
  const dryRun = options.dryRun ?? false;
  const horizonDays = options.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const lookbackDays = options.lookbackDays ?? 0;

  const db = getDb();
  if (!db) throw new Error('Supabase not configured');

  // Fetch and reconcile bounds both start at ET midnight of the first day —
  // see syncRange for why fetching from `now` corrupted today's shifts.
  const { startAfter, startBefore, rangeStart, rangeEnd } = syncRange(new Date().toISOString(), {
    horizonDays,
    lookbackDays,
  });

  const [sessions, appointments, tagFeed, staffingRules] = await Promise.all([
    fetchHostSessions({ startAfter, startBefore }),
    fetchAppointmentReservations({ startAfter, startBefore }),
    // Tags for staffing rules. The host sessions endpoint doesn't carry them;
    // the public feed does, keyed by the same session id. Unpublished
    // sessions aren't in it and so match no tag rule.
    fetchMomenceEvents().catch((error: unknown) => {
      console.warn(
        '[sync-shifts] events feed unavailable, staffing counts left as they are:',
        error instanceof Error ? error.message : error
      );
      return null;
    }),
    loadStaffingRules(),
  ]);
  const tagsById = new Map(
    (tagFeed ?? []).map((e) => [
      Number(e.id),
      Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === 'string') : [],
    ])
  );

  const events: CoverageEvent[] = [];
  for (const s of sessions) {
    const event = toEvent(
      'session',
      s.id,
      s.name ?? 'Session',
      s.startsAt,
      s.endsAt,
      tagsById.get(s.id) ?? []
    );
    if (event) events.push(event);
  }
  for (const a of appointments) {
    const event = toEvent(
      'appointment',
      a.id,
      a.serviceName ?? 'Appointment',
      a.startsAt,
      a.endsAt
    );
    if (event) events.push(event);
  }

  const windows = deriveCoverageWindows(events);
  for (const w of windows) {
    w.staffNeeded = staffNeededFor(staffingRules ?? [], {
      date: w.date,
      startMin: w.startMin,
      label: w.label,
      titles: w.titles,
      tags: w.tags ?? [],
    });
  }

  // Existing non-draft shifts across the local-date horizon: momence shifts
  // for matching (all statuses, so a re-appearing session doesn't duplicate a
  // cancelled row's window) and manual shifts so the planner can suppress
  // momence duplicates of windows an admin-entered shift already covers.
  const { data: shiftRows, error: shiftsError } = await db
    .from('shifts')
    .select(
      'id, shift_date, label, starts_at, ends_at, source, momence_session_ids, sync_locked, status, sync_flag, is_draft, notes, sessions_start_at, sessions_end_at, staff_needed, staff_needed_manual'
    )
    .eq('is_draft', false)
    .gte('shift_date', rangeStart)
    .lte('shift_date', rangeEnd);
  if (shiftsError) throw new Error(shiftsError.message);

  const shiftIds = (shiftRows ?? []).map((s) => s.id);
  const assignmentCounts = new Map<string, number>();
  if (shiftIds.length > 0) {
    const { data: assignmentRows, error: assignmentsError } = await db
      .from('shift_assignments')
      .select('shift_id')
      .in('shift_id', shiftIds)
      .eq('is_draft', false);
    if (assignmentsError) throw new Error(assignmentsError.message);
    for (const row of assignmentRows ?? []) {
      assignmentCounts.set(row.shift_id, (assignmentCounts.get(row.shift_id) ?? 0) + 1);
    }
  }

  const existing: SyncShiftInput[] = (shiftRows ?? []).map((s) => ({
    ...s,
    assignmentCount: assignmentCounts.get(s.id) ?? 0,
  }));
  const notesById = new Map((shiftRows ?? []).map((s) => [s.id, s.notes as string | null]));

  const plan = planShiftSync(windows, existing, {
    applyStaffing: staffingRules !== null && tagFeed !== null,
  });

  const summary: SyncShiftsSummary = {
    dryRun,
    horizonDays,
    lookbackDays,
    events: events.length,
    windows: windows.length,
    created: plan.create.length,
    updated: plan.update.length,
    cancelled: plan.cancel.length,
    flagged: plan.flag.length,
    flagsCleared: plan.clearFlag.length,
    staffingUpdated: plan.staffing.length,
  };
  if (dryRun) return summary;

  if (plan.create.length > 0) {
    const { error } = await db.from('shifts').insert(
      plan.create.map((w) => ({
        shift_date: w.date,
        label: w.label,
        starts_at: minutesToTime(w.startMin),
        ends_at: minutesToTime(w.endMin === DAY_MIN ? DAY_MIN - 1 : w.endMin),
        staff_needed: w.staffNeeded,
        source: 'momence',
        momence_session_ids: w.sessionRefs,
        notes: notesForTitles(w.titles),
        sessions_start_at: w.sessionsStartMin === null ? null : minutesToTime(w.sessionsStartMin),
        sessions_end_at:
          w.sessionsEndMin === null ? null : minutesToTime(Math.min(w.sessionsEndMin, DAY_MIN - 1)),
      }))
    );
    if (error) throw new Error(error.message);
  }

  for (const update of plan.update) {
    const { error } = await db
      .from('shifts')
      .update({
        starts_at: update.startsAt,
        ends_at: update.endsAt,
        momence_session_ids: update.sessionRefs,
        // Titles too: a session added to a day the sync already shifted
        // (a special event dropped into an evening of Open Hours) has to
        // reach the notes, or the board keeps reading "Open Hours".
        notes: update.notes,
        sessions_start_at: update.sessionsStartAt,
        sessions_end_at: update.sessionsEndAt,
        sync_flag: null,
      })
      .eq('id', update.shiftId);
    if (error) throw new Error(error.message);
  }

  // A shift whose times Momence moved has a crew that needs to know; the
  // planner only cancels unstaffed shifts, and flags are for the admins.
  // An update can also be titles-only (a session renamed, or one added to a
  // day already at the right hours) — nothing has moved for the crew there,
  // so the times have to have actually changed before anyone is told.
  const shiftById = new Map((shiftRows ?? []).map((s) => [s.id as string, s]));
  for (const update of plan.update) {
    const row = shiftById.get(update.shiftId);
    if (!row) continue;
    // Compared in minutes, not as text: the column reads back as '09:00:00'
    // and the planner writes '09:00', so a string check would never match.
    if (
      timeToMinutes(row.starts_at as string) === timeToMinutes(update.startsAt) &&
      timeToMinutes(row.ends_at as string) === timeToMinutes(update.endsAt)
    ) {
      continue;
    }
    const staffIds = await assigneesOf(db, update.shiftId);
    if (staffIds.length === 0) continue;
    await notifyShiftChange(db, {
      change: 'updated',
      shift: {
        id: row.id as string,
        label: row.label as string,
        shift_date: row.shift_date as string,
        starts_at: update.startsAt,
        ends_at: update.endsAt,
      },
      staffIds,
      detail: `Momence moved it to ${update.startsAt.slice(0, 5)}–${update.endsAt.slice(0, 5)}`,
      actorEmail: null,
    });
  }

  for (const cancel of plan.cancel) {
    const { error } = await db
      .from('shifts')
      .update({
        status: 'cancelled',
        sync_flag: null,
        notes: notesById.get(cancel.shiftId) || cancel.reason,
      })
      .eq('id', cancel.shiftId);
    if (error) throw new Error(error.message);
  }

  for (const flag of plan.flag) {
    const { error } = await db
      .from('shifts')
      .update({ sync_flag: flag.flag })
      .eq('id', flag.shiftId);
    if (error) throw new Error(error.message);
  }

  // Session edges only: the window and everyone's hours stay as they are —
  // the edges just set the default hours for whoever is added next. Not
  // counted in the summary; nothing on the board moves.
  for (const edges of plan.edges) {
    const { error } = await db
      .from('shifts')
      .update({ sessions_start_at: edges.sessionsStartAt, sessions_end_at: edges.sessionsEndAt })
      .eq('id', edges.shiftId);
    if (error) throw new Error(error.message);
  }

  // Head counts from the staffing rules: the coverage target only, so nobody
  // on the shift is told — the board's 1/3 just reads differently.
  for (const change of plan.staffing) {
    const { error } = await db
      .from('shifts')
      .update({ staff_needed: change.staffNeeded })
      .eq('id', change.shiftId);
    if (error) throw new Error(error.message);
  }

  if (plan.clearFlag.length > 0) {
    const { error } = await db.from('shifts').update({ sync_flag: null }).in('id', plan.clearFlag);
    if (error) throw new Error(error.message);
  }

  // One change-log entry per run that actually changed something — the
  // no-op hourly runs stay out of the log.
  const parts = (
    [
      ['created', summary.created],
      ['updated', summary.updated],
      ['cancelled', summary.cancelled],
      ['flagged', summary.flagged],
      ['flags cleared', summary.flagsCleared],
      ['head counts changed', summary.staffingUpdated],
    ] as const
  ).filter(([, n]) => n > 0);
  if (parts.length > 0) {
    await logScheduleChange(db, {
      actor: options.actor ?? SYNC_ACTOR,
      entityType: 'sync',
      action: 'sync',
      summary: `Momence sync: ${parts.map(([label, n]) => `${n} ${label}`).join(', ')}`,
      details: { ...summary },
    });
  }

  return summary;
}
