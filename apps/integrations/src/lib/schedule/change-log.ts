// Append-only audit log for staff-scheduling mutations (schedule_changes
// table): who changed what, written from the mutation routes and the Momence
// sync. Read admin-only via /api/admin/schedule-changes for the
// /admin/schedule/changes page.
//
// Logging is best-effort by design: a failed log insert must never fail the
// mutation it describes, so errors are warned and swallowed.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminGate } from '@/lib/auth/admin';

export type ChangeEntityType =
  | 'shift'
  | 'assignment'
  | 'time_off'
  | 'proposal'
  | 'sync'
  | 'request'
  | 'sub_request';

export type ChangeAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'propose'
  | 'approve'
  | 'discard'
  | 'accept_item'
  | 'reject_item'
  | 'sync'
  | 'deny'
  | 'refine';

export interface ScheduleChangeRow {
  id: string;
  actor_kind: 'user' | 'agent' | 'system';
  actor_email: string | null;
  actor_label: string;
  entity_type: ChangeEntityType;
  entity_id: string | null;
  action: ChangeAction;
  summary: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface ChangeActor {
  kind: ScheduleChangeRow['actor_kind'];
  email: string | null;
  label: string;
}

/** The dashboard login behind an admin-route mutation. */
export function actorFromGate(gate: AdminGate): ChangeActor {
  const email = (gate.user.email ?? '').toLowerCase() || null;
  const name = [gate.user.firstName, gate.user.lastName].filter(Boolean).join(' ').trim();
  return { kind: 'user', email, label: name || email || 'Unknown user' };
}

export const AGENT_ACTOR: ChangeActor = { kind: 'agent', email: null, label: 'Scheduling agent' };
export const SYNC_ACTOR: ChangeActor = { kind: 'system', email: null, label: 'Momence sync' };

export async function logScheduleChange(
  db: SupabaseClient,
  change: {
    actor: ChangeActor;
    entityType: ChangeEntityType;
    entityId?: string | null;
    action: ChangeAction;
    summary: string;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    const { error } = await db.from('schedule_changes').insert({
      actor_kind: change.actor.kind,
      actor_email: change.actor.email,
      actor_label: change.actor.label,
      entity_type: change.entityType,
      entity_id: change.entityId ?? null,
      action: change.action,
      summary: change.summary,
      details: change.details ?? {},
    });
    if (error) console.warn('[schedule-changes] log insert failed:', error.message);
  } catch (error) {
    console.warn('[schedule-changes] log insert failed:', error);
  }
}

/**
 * The keys of `after` whose values differ from `before`, as before/after
 * snapshots of just those keys. Null when nothing changed (e.g. a PATCH that
 * resubmitted the same values).
 */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const beforeOut: Record<string, unknown> = {};
  const afterOut: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(after[key] ?? null) !== JSON.stringify(before[key] ?? null)) {
      beforeOut[key] = before[key] ?? null;
      afterOut[key] = after[key] ?? null;
    }
  }
  return Object.keys(afterOut).length > 0 ? { before: beforeOut, after: afterOut } : null;
}

/** Compact "field old → new" list for update summaries. */
export function summarizeDiff(diff: {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}): string {
  const scalar = (v: unknown): string => {
    if (v == null || v === '') return '(none)';
    if (typeof v === 'string' && TIME_WITH_SECONDS_RE.test(v)) return v.slice(0, 5);
    // Set-valued columns (an assignment's duties) read better spelled out
    // than as "changed" — an emptied set is still "(none)".
    if (Array.isArray(v)) return v.length > 0 ? v.join(', ') : '(none)';
    return String(v);
  };
  const printable = (v: unknown): boolean =>
    v == null ||
    ['string', 'number', 'boolean'].includes(typeof v) ||
    (Array.isArray(v) && v.every((item) => ['string', 'number', 'boolean'].includes(typeof item)));
  return Object.keys(diff.after)
    .map((key) => {
      const before = diff.before[key];
      const after = diff.after[key];
      return printable(before) && printable(after)
        ? `${key} ${scalar(before)} → ${scalar(after)}`
        : `${key} changed`;
    })
    .join(', ');
}

const TIME_WITH_SECONDS_RE = /^\d{2}:\d{2}:\d{2}$/;

/** "'Morning' on 2026-08-14" */
export function describeShift(shift: { label: string; shift_date: string }): string {
  return `'${shift.label}' on ${shift.shift_date}`;
}

/** "09:00–13:00" */
export function timeWindow(row: { starts_at: string; ends_at: string }): string {
  return `${row.starts_at.slice(0, 5)}–${row.ends_at.slice(0, 5)}`;
}

/** Roster display name for summaries; falls back rather than failing the log. */
export async function staffNameOf(db: SupabaseClient, staffId: string): Promise<string> {
  const { data } = await db.from('staff').select('display_name').eq('id', staffId).maybeSingle();
  return (data?.display_name as string | undefined) ?? 'Unknown staff';
}

const DAY_ABBREV = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Sunny: 2026-08-14–2026-08-18" / "Sunny: weekly on Mon, Wed (09:00–12:00)" */
export function describeTimeOff(
  name: string,
  entry: {
    kind: string;
    start_date: string | null;
    end_date: string | null;
    days_of_week: number[];
    starts_at: string | null;
    ends_at: string | null;
  }
): string {
  const when =
    entry.kind === 'recurring'
      ? `weekly on ${entry.days_of_week.map((d) => DAY_ABBREV[d] ?? d).join(', ')}`
      : `${entry.start_date}–${entry.end_date}`;
  const times =
    entry.starts_at && entry.ends_at
      ? ` (${timeWindow({ starts_at: entry.starts_at, ends_at: entry.ends_at })})`
      : '';
  return `${name}: ${when}${times}`;
}
