// Schedule events → the inboxes of the people they affect. Called from the
// same routes that write the schedule change log, right after the log entry,
// with the same best-effort contract (a failed notice never fails the
// mutation).
//
// Rules shared by every writer here: draft rows never notify (the accept
// path does, once they go live); shifts already in the past never notify;
// changes to a single shift or assignment notify only inside the current
// week (later weeks reach people through the Monday shifts email);
// the person who made the change never hears about it from themselves; and
// a newer notice about the same shift replaces the stale unread one.

import type { SupabaseClient } from '@supabase/supabase-js';
import { listStaff } from '@/lib/auth/access';
import { todayEastern } from '@/lib/shift-notes/validate';
import { createNotifications } from './notify';
import {
  adminEmails,
  canOpenSchedule,
  nameFor,
  type RosterRow,
  rosterByEmail,
  rosterById,
} from './recipients';
import {
  type AssignmentChange,
  assignmentChangeText,
  proposalApprovedText,
  type ShiftChange,
  type ShiftLike,
  type SubEvent,
  shiftChangeText,
  subRequestText,
} from './text';
import { inCurrentWeek, scheduleHref, shiftNotificationExpiry } from './types';

export interface ShiftForNotice extends ShiftLike {
  id: string;
  is_draft?: boolean;
}

/** Outside the current week — too far out to interrupt anyone about. */
function beyondThisWeek(shift: { shift_date: string }): boolean {
  return !inCurrentWeek(shift.shift_date, todayEastern());
}

function inPast(shift: { shift_date: string }): boolean {
  return shift.shift_date < todayEastern();
}

/** The board link for a person, or none when they can't open the board. */
function boardHref(rows: RosterRow[], shift: { id: string; shift_date: string }) {
  const byEmail = rosterByEmail(rows);
  return (recipient: string): string | null => {
    const row = byEmail.get(recipient);
    return row && canOpenSchedule(row) ? scheduleHref(shift) : null;
  };
}

/** One person was put on, taken off, or re-timed on a shift. */
export async function notifyAssignmentChange(
  db: SupabaseClient,
  input: {
    change: AssignmentChange;
    shift: ShiftForNotice;
    staffId: string;
    assignment?: { starts_at: string; ends_at: string; is_draft?: boolean } | null;
    detail?: string | null;
    actorEmail: string | null;
  }
): Promise<void> {
  if (
    input.shift.is_draft ||
    input.assignment?.is_draft ||
    inPast(input.shift) ||
    beyondThisWeek(input.shift)
  ) {
    return;
  }
  const rows = (await listStaff()) ?? [];
  const person = rosterById(rows).get(input.staffId);
  const email = (person?.email ?? '').trim().toLowerCase();
  if (!email) return;

  const text = assignmentChangeText({
    change: input.change,
    shift: input.shift,
    assignment: input.assignment,
    detail: input.detail,
    actorName: input.actorEmail ? nameFor(rows, input.actorEmail) : null,
  });
  await createNotifications(db, [email], {
    kind: 'schedule_change',
    ...text,
    href: boardHref(rows, input.shift),
    source: { type: 'shift', id: input.shift.id },
    actorEmail: input.actorEmail,
    expiresAt: shiftNotificationExpiry(input.shift.shift_date),
    supersede: true,
  });
}

/** A shift everyone in `staffIds` is on changed, was cancelled, or was removed. */
export async function notifyShiftChange(
  db: SupabaseClient,
  input: {
    change: ShiftChange;
    shift: ShiftForNotice;
    staffIds: string[];
    detail?: string | null;
    actorEmail: string | null;
  }
): Promise<void> {
  if (
    input.shift.is_draft ||
    inPast(input.shift) ||
    beyondThisWeek(input.shift) ||
    input.staffIds.length === 0
  ) {
    return;
  }
  const rows = (await listStaff()) ?? [];
  const byId = rosterById(rows);
  const emails = input.staffIds
    .map((id) => (byId.get(id)?.email ?? '').trim().toLowerCase())
    .filter(Boolean);
  if (emails.length === 0) return;

  const text = shiftChangeText({
    change: input.change,
    shift: input.shift,
    detail: input.detail,
    actorName: input.actorEmail ? nameFor(rows, input.actorEmail) : null,
  });
  await createNotifications(db, emails, {
    kind: 'schedule_change',
    ...text,
    // A removed shift has nothing to open; the board still shows the day.
    href: boardHref(rows, input.shift),
    source: { type: 'shift', id: input.shift.id },
    actorEmail: input.actorEmail,
    expiresAt: shiftNotificationExpiry(input.shift.shift_date),
    supersede: true,
  });
}

/**
 * Non-draft assignees of `shiftId`, for the routes that change a whole
 * shift. Empty on any failure — the notice is best-effort.
 */
export async function assigneesOf(db: SupabaseClient, shiftId: string): Promise<string[]> {
  const { data, error } = await db
    .from('shift_assignments')
    .select('staff_id')
    .eq('shift_id', shiftId)
    .eq('is_draft', false);
  if (error) {
    console.warn('[notifications] assignees lookup failed:', error.message);
    return [];
  }
  return (data ?? []).map((row) => row.staff_id as string);
}

/** A draft week went live: one summary per person with shifts in it. */
export async function notifyProposalApproved(
  db: SupabaseClient,
  input: {
    proposalId: string;
    weekStart: string;
    assignments: { staff_id: string; shift_id: string }[];
    actorEmail: string | null;
  }
): Promise<void> {
  if (input.assignments.length === 0) return;
  const rows = (await listStaff()) ?? [];
  const byId = rosterById(rows);
  const byEmail = rosterByEmail(rows);
  const actorName = input.actorEmail ? nameFor(rows, input.actorEmail) : null;

  const counts = new Map<string, number>();
  for (const a of input.assignments) {
    const email = (byId.get(a.staff_id)?.email ?? '').trim().toLowerCase();
    if (!email) continue;
    counts.set(email, (counts.get(email) ?? 0) + 1);
  }
  // One row per person, since each carries its own count.
  for (const [email, shiftCount] of counts) {
    const row = byEmail.get(email);
    await createNotifications(db, [email], {
      kind: 'schedule_change',
      ...proposalApprovedText({ weekStart: input.weekStart, shiftCount, actorName }),
      href:
        row && canOpenSchedule(row) ? `/admin/schedule?view=week&date=${input.weekStart}` : null,
      source: { type: 'proposal', id: input.proposalId },
      actorEmail: input.actorEmail,
      expiresAt: shiftNotificationExpiry(addDays(input.weekStart, 7)),
      supersede: true,
    });
  }
}

function addDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Sub-request activity. `requested` reaches the people who could claim it
 * (the same list the emails go to) and the admins; `claimed` reaches the
 * requester and the admins; `cancelled` reaches the admins. The actor is
 * never among them.
 */
export async function notifySubEvent(
  db: SupabaseClient,
  input: {
    event: SubEvent;
    subId: string;
    shift: ShiftForNotice;
    window: { starts_at: string; ends_at: string };
    requesterStaffId: string;
    claimerStaffId?: string | null;
    /** Staff ids of the people asked to cover (requested only). */
    candidateStaffIds?: string[];
    actorEmail: string | null;
  }
): Promise<void> {
  if (inPast(input.shift)) return;
  const rows = (await listStaff()) ?? [];
  const byId = rosterById(rows);
  const requester = byId.get(input.requesterStaffId);
  const claimer = input.claimerStaffId ? byId.get(input.claimerStaffId) : null;
  const requesterName = requester?.display_name?.trim() || 'Someone';
  const claimerName = claimer?.display_name?.trim() || null;
  const requesterEmail = (requester?.email ?? '').trim().toLowerCase();
  const common = {
    event: input.event,
    shift: input.shift,
    window: input.window,
    requesterName,
    claimerName,
  };
  const base = {
    kind: 'sub_request' as const,
    href: boardHref(rows, input.shift),
    source: { type: 'sub_request', id: input.subId },
    actorEmail: input.actorEmail,
    expiresAt: shiftNotificationExpiry(input.shift.shift_date),
    supersede: true,
  };

  const admins = adminEmails(rows);
  if (input.event === 'requested') {
    const candidates = (input.candidateStaffIds ?? [])
      .map((id) => (byId.get(id)?.email ?? '').trim().toLowerCase())
      .filter(Boolean);
    const candidateSet = new Set(candidates);
    await createNotifications(db, candidates, {
      ...base,
      ...subRequestText({ ...common, forCandidate: true }),
    });
    await createNotifications(
      db,
      admins.filter((email) => !candidateSet.has(email)),
      { ...base, ...subRequestText(common) }
    );
    return;
  }
  if (input.event === 'claimed') {
    if (requesterEmail) {
      await createNotifications(db, [requesterEmail], {
        ...base,
        ...subRequestText({ ...common, forRequester: true }),
      });
    }
    await createNotifications(
      db,
      admins.filter((email) => email !== requesterEmail),
      { ...base, ...subRequestText(common) }
    );
    return;
  }
  await createNotifications(db, admins, { ...base, ...subRequestText(common) });
}
