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

import {
  type CoverageEvent,
  deriveCoverageWindows,
  minutesToTime,
  planShiftSync,
  type SyncShiftInput,
  utcToEastern,
} from '@pyre/schedule-core';
import { getDb } from '@/lib/db';
import { fetchAppointmentReservations, fetchHostSessions } from '@/lib/momence/host-api';

const DAY_MIN = 24 * 60;
const DEFAULT_HORIZON_DAYS = 21;
/** Fallback duration when Momence omits an appointment end time. */
const APPOINTMENT_FALLBACK_MIN = 60;

export interface SyncShiftsSummary {
  dryRun: boolean;
  horizonDays: number;
  events: number;
  windows: number;
  created: number;
  updated: number;
  cancelled: number;
  flagged: number;
  flagsCleared: number;
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
  endsAt: string | null
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
  return { kind, id, title, date: start.date, startMin: start.minutes, endMin };
}

export async function syncShifts(
  options: { dryRun?: boolean; horizonDays?: number } = {}
): Promise<SyncShiftsSummary> {
  const dryRun = options.dryRun ?? false;
  const horizonDays = options.horizonDays ?? DEFAULT_HORIZON_DAYS;

  const db = getDb();
  if (!db) throw new Error('Supabase not configured');

  const now = new Date();
  const horizonEnd = new Date(now.getTime() + horizonDays * 86_400_000);
  const startAfter = now.toISOString();
  const startBefore = horizonEnd.toISOString();

  const [sessions, appointments] = await Promise.all([
    fetchHostSessions({ startAfter, startBefore }),
    fetchAppointmentReservations({ startAfter, startBefore }),
  ]);

  const events: CoverageEvent[] = [];
  for (const s of sessions) {
    const event = toEvent('session', s.id, s.name ?? 'Session', s.startsAt, s.endsAt);
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

  // Existing momence shifts across the local-date horizon (all statuses so a
  // re-appearing session doesn't duplicate a cancelled row's window).
  const rangeStart = utcToEastern(startAfter).date;
  const rangeEnd = utcToEastern(startBefore).date;
  const { data: shiftRows, error: shiftsError } = await db
    .from('shifts')
    .select(
      'id, shift_date, starts_at, ends_at, source, momence_session_ids, sync_locked, status, sync_flag, is_draft, notes'
    )
    .eq('source', 'momence')
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

  const plan = planShiftSync(windows, existing);

  const summary: SyncShiftsSummary = {
    dryRun,
    horizonDays,
    events: events.length,
    windows: windows.length,
    created: plan.create.length,
    updated: plan.update.length,
    cancelled: plan.cancel.length,
    flagged: plan.flag.length,
    flagsCleared: plan.clearFlag.length,
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
        notes: w.titles.join(', ').slice(0, 200) || null,
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
        sync_flag: null,
      })
      .eq('id', update.shiftId);
    if (error) throw new Error(error.message);
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

  if (plan.clearFlag.length > 0) {
    const { error } = await db.from('shifts').update({ sync_flag: null }).in('id', plan.clearFlag);
    if (error) throw new Error(error.message);
  }

  return summary;
}
