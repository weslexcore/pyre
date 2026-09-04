// The SOPs someone is on the hook for right now: the duties on their own
// current-or-next shift, resolved to the documents that define them. Feeds
// the "Shift SOPs" block on the admin home (under the shift chip) and the
// same block at the top of the SOP library. Server-only.
//
// Always the *viewer's own* shift, never the schedule-wide next one an admin
// sees in the chip — an admin who isn't working tonight has no shift SOPs,
// and one who is gets theirs like anyone else.

import type { AssignmentDuty } from '@pyre/schedule-core';
import {
  ASSIGNMENT_DUTY_DETAILS,
  ASSIGNMENT_DUTY_LABELS,
  ASSIGNMENT_DUTY_SOPS,
  normalizeDuties,
} from '@pyre/schedule-core';
import { listStaff } from '@/lib/auth/access';
import type { getDb, SopRow } from '@/lib/db';
import { getNextUpcomingShift } from '@/lib/schedule/next-shift';
import { countTasks } from './checklist';
import { canViewSop, normalizeEmail, type SopViewer } from './levels';

type Db = NonNullable<ReturnType<typeof getDb>>;

/** One duty on the shift, with the document that defines it. */
export interface ShiftSop {
  duty: AssignmentDuty;
  /** "Set Up (A)". */
  label: string;
  /** "Fire + Water" — what the letter actually covers; null for host/care. */
  detail: string | null;
  slug: string;
  title: string;
  /** Checklist items in the document; 0 = prose, nothing to run. */
  taskCount: number;
}

export interface ShiftSops {
  shiftId: string;
  shiftDate: string;
  shiftLabel: string;
  /** On today's ET date — the shift may already be in progress. */
  isToday: boolean;
  /** Live right now on the ET clock. */
  isInSession: boolean;
  /** In shift order (set up → session → break down), one per duty held. */
  sops: ShiftSop[];
}

/**
 * Pair each duty with the document defining it, in the order the duties were
 * given (set up → session → break down). Duties whose document is missing or
 * off-limits simply drop out — the block names documents this person can
 * open, not ones they can't.
 */
export function resolveShiftSops(
  duties: readonly AssignmentDuty[],
  rows: readonly SopRow[],
  viewer: SopViewer
): ShiftSop[] {
  const bySlug = new Map<string, SopRow>();
  for (const sop of rows) {
    if (canViewSop(viewer, sop)) bySlug.set(sop.slug, sop);
  }
  return duties.flatMap((duty) => {
    const sop = bySlug.get(ASSIGNMENT_DUTY_SOPS[duty]);
    if (!sop) return [];
    return [
      {
        duty,
        label: ASSIGNMENT_DUTY_LABELS[duty],
        detail: ASSIGNMENT_DUTY_DETAILS[duty],
        slug: sop.slug,
        title: sop.title,
        taskCount: countTasks(sop.content_md),
      },
    ];
  });
}

/** The roster id behind a session email, or null when it names nobody. */
async function staffIdForEmail(email: string): Promise<string | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const rows = await listStaff();
  return rows?.find((row) => normalizeEmail(row.email) === normalized)?.id ?? null;
}

/**
 * The duty documents for this viewer's own current-or-next shift, or null
 * when they aren't on the roster, have no upcoming shift, hold no duties on
 * it, or may read none of the documents those duties name. Decorative like
 * the chip it sits under, so every failure path returns null rather than
 * surfacing an error.
 */
export async function loadShiftSops(db: Db, viewer: SopViewer): Promise<ShiftSops | null> {
  const staffId = await staffIdForEmail(viewer.email);
  if (!staffId) return null;

  const next = await getNextUpcomingShift(db, staffId);
  if (!next) return null;

  // A shift can be split across assignments (a Setup block plus a full one);
  // normalizeDuties dedupes them and puts the union in shift order.
  const duties = normalizeDuties(next.assignments.flatMap((a) => a.duties));
  if (duties.length === 0) return null;

  const slugs = [...new Set(duties.map((duty) => ASSIGNMENT_DUTY_SOPS[duty]))];
  const { data, error } = await db.from('sops').select('*').in('slug', slugs);
  if (error) return null;

  const sops = resolveShiftSops(duties, (data ?? []) as SopRow[], viewer);
  if (sops.length === 0) return null;

  return {
    shiftId: next.shift.id,
    shiftDate: next.shift.shift_date,
    shiftLabel: next.shift.label,
    isToday: next.isToday,
    isInSession: next.isInSession,
    sops,
  };
}
