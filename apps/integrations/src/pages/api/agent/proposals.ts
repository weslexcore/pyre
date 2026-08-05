// Agent-facing proposal writer: the pyre-agents scheduler submits one draft
// batch per week — new shifts plus assignments (which may attach to existing
// live shifts) — and this route validates everything with the SAME parsers
// the admin edit routes use, enforces the hard time-off rule server-side,
// supersedes the week's previous draft, and writes the batch as is_draft
// rows for review on /admin/schedule.
//
// Auth: Bearer AGENT_API_SECRET (server-to-server; never cookies). dryRun
// validates and returns the conflict report without writing — used by evals.

import {
  availabilityFor,
  type StaffRow,
  type TimeOffRow,
  timeToMinutes,
  weekStartOf,
} from '@pyre/schedule-core';
import type { APIRoute } from 'astro';
import { agentUnauthorizedResponse, isAgentAuthorized } from '@/lib/agent/auth';
import { getDb } from '@/lib/db';
import { DATE_RE, parseAssignmentFields, parseShiftFields } from '@/lib/schedule/validate';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const MAX_SHIFTS = 40;
const MAX_ASSIGNMENTS = 120;

interface ConflictEntry {
  staffId: string;
  staffName: string;
  date: string;
  window: string;
  /** busy = fully blocked (rejected); partial = overlap warning (allowed). */
  severity: 'busy' | 'partial';
  reasons: string[];
}

export const POST: APIRoute = async ({ request }) => {
  if (!isAgentAuthorized(request)) return agentUnauthorizedResponse();

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const weekStart = body.weekStart;
  if (
    typeof weekStart !== 'string' ||
    !DATE_RE.test(weekStart) ||
    weekStartOf(weekStart) !== weekStart
  ) {
    return json({ error: 'weekStart must be a Monday as YYYY-MM-DD' }, 400);
  }
  const weekEnd = addDays(weekStart, 6);

  const source = body.source === 'cron' ? 'cron' : 'manual';
  const agentSessionId = typeof body.agentSessionId === 'string' ? body.agentSessionId : null;
  const rationale = typeof body.rationale === 'string' ? body.rationale.slice(0, 8000) : null;
  const summary =
    body.summary && typeof body.summary === 'object' && !Array.isArray(body.summary)
      ? (body.summary as Record<string, unknown>)
      : {};
  const dryRun = body.dryRun === true;

  const rawShifts = Array.isArray(body.shifts) ? body.shifts : [];
  const rawAssignments = Array.isArray(body.assignments) ? body.assignments : [];
  if (rawShifts.length > MAX_SHIFTS) return json({ error: `At most ${MAX_SHIFTS} shifts` }, 400);
  if (rawAssignments.length > MAX_ASSIGNMENTS) {
    return json({ error: `At most ${MAX_ASSIGNMENTS} assignments` }, 400);
  }
  if (rawAssignments.length === 0 && rawShifts.length === 0) {
    return json({ error: 'Proposal is empty' }, 400);
  }

  // --- Validate draft shifts ---
  const draftShifts: Array<{ key: string; columns: Record<string, unknown> }> = [];
  const shiftKeys = new Set<string>();
  for (const [i, raw] of rawShifts.entries()) {
    const s = raw as Record<string, unknown>;
    const key = typeof s.key === 'string' && s.key ? s.key : `shift-${i}`;
    if (shiftKeys.has(key)) return json({ error: `Duplicate shift key '${key}'` }, 400);
    shiftKeys.add(key);

    const columns = parseShiftFields(s);
    if (typeof columns === 'string') return json({ error: `shifts[${i}]: ${columns}` }, 400);
    for (const required of ['shift_date', 'label', 'starts_at', 'ends_at'] as const) {
      if (columns[required] === undefined) {
        return json({ error: `shifts[${i}]: shiftDate, label, startsAt, endsAt required` }, 400);
      }
    }
    const date = columns.shift_date as string;
    if (date < weekStart || date > weekEnd) {
      return json({ error: `shifts[${i}]: ${date} is outside week ${weekStart}` }, 400);
    }
    draftShifts.push({ key, columns });
  }

  // --- Load reference data ---
  const [staffRes, liveShiftsRes, timeOffRes] = await Promise.all([
    db.from('staff').select('*'),
    db
      .from('shifts')
      .select('id, shift_date, starts_at, ends_at, status, is_draft')
      .gte('shift_date', weekStart)
      .lte('shift_date', weekEnd),
    db.from('time_off').select('*'),
  ]);
  const refError = staffRes.error ?? liveShiftsRes.error ?? timeOffRes.error;
  if (refError) return json({ error: refError.message }, 500);

  const staff = (staffRes.data ?? []) as StaffRow[];
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const timeOff = (timeOffRes.data ?? []) as TimeOffRow[];
  const liveShiftById = new Map(
    (liveShiftsRes.data ?? []).filter((s) => !s.is_draft).map((s) => [s.id as string, s])
  );

  // --- Validate assignments ---
  interface DraftAssignment {
    shiftId: string | null;
    shiftKey: string | null;
    staffId: string;
    columns: Record<string, unknown>;
    date: string;
    startsAt: string;
    endsAt: string;
  }
  const draftAssignments: DraftAssignment[] = [];
  const seenPairs = new Set<string>();

  for (const [i, raw] of rawAssignments.entries()) {
    const a = raw as Record<string, unknown>;
    const staffId = a.staffId;
    if (typeof staffId !== 'string' || !staffById.has(staffId)) {
      return json({ error: `assignments[${i}]: unknown staffId` }, 400);
    }
    if (!(staffById.get(staffId) as StaffRow).active) {
      return json({ error: `assignments[${i}]: staff member is inactive` }, 400);
    }

    const columns = parseAssignmentFields(a);
    if (typeof columns === 'string') return json({ error: `assignments[${i}]: ${columns}` }, 400);

    let date: string;
    let windowStart: string;
    let windowEnd: string;
    let shiftId: string | null = null;
    let shiftKey: string | null = null;

    if (typeof a.shiftId === 'string' && a.shiftId) {
      const live = liveShiftById.get(a.shiftId);
      if (!live) return json({ error: `assignments[${i}]: unknown shiftId` }, 400);
      if (live.status !== 'active') {
        return json({ error: `assignments[${i}]: shift is cancelled` }, 400);
      }
      shiftId = a.shiftId;
      date = live.shift_date as string;
      windowStart = live.starts_at as string;
      windowEnd = live.ends_at as string;
    } else if (typeof a.shiftKey === 'string' && shiftKeys.has(a.shiftKey)) {
      shiftKey = a.shiftKey;
      const draft = draftShifts.find((s) => s.key === a.shiftKey);
      if (!draft) return json({ error: `assignments[${i}]: unknown shiftKey` }, 400);
      date = draft.columns.shift_date as string;
      windowStart = draft.columns.starts_at as string;
      windowEnd = draft.columns.ends_at as string;
    } else {
      return json({ error: `assignments[${i}]: needs shiftId or shiftKey` }, 400);
    }

    const pairKey = `${shiftId ?? shiftKey}:${staffId}`;
    if (seenPairs.has(pairKey)) {
      return json({ error: `assignments[${i}]: duplicate person on one shift` }, 400);
    }
    seenPairs.add(pairKey);

    const startsAt = (columns.starts_at as string) ?? windowStart;
    const endsAt = (columns.ends_at as string) ?? windowEnd;
    if (endsAt.slice(0, 5) <= startsAt.slice(0, 5)) {
      return json({ error: `assignments[${i}]: endsAt must be after startsAt` }, 400);
    }

    draftAssignments.push({ shiftId, shiftKey, staffId, columns, date, startsAt, endsAt });
  }

  // --- Hard time-off enforcement + conflict report ---
  const conflicts: ConflictEntry[] = [];
  for (const a of draftAssignments) {
    const availability = availabilityFor(
      timeOff,
      a.staffId,
      a.date,
      timeToMinutes(a.startsAt),
      timeToMinutes(a.endsAt)
    );
    if (availability.status !== 'free') {
      conflicts.push({
        staffId: a.staffId,
        staffName: staffById.get(a.staffId)?.display_name ?? '?',
        date: a.date,
        window: `${a.startsAt.slice(0, 5)}–${a.endsAt.slice(0, 5)}`,
        severity: availability.status,
        reasons: availability.conflicts.map((c) => c.note || 'time off'),
      });
    }
  }
  const hardConflicts = conflicts.filter((c) => c.severity === 'busy');
  if (hardConflicts.length > 0) {
    return json(
      {
        error: 'Assignments overlap hard time off — reassign these and resubmit',
        conflicts,
      },
      422
    );
  }

  if (dryRun) {
    return json({
      ok: true,
      dryRun: true,
      weekStart,
      shifts: draftShifts.length,
      assignments: draftAssignments.length,
      conflicts,
    });
  }

  // --- Supersede the week's previous draft ---
  const { data: openProposals, error: openError } = await db
    .from('schedule_proposals')
    .select('id')
    .eq('week_start', weekStart)
    .eq('status', 'draft');
  if (openError) return json({ error: openError.message }, 500);
  for (const prior of openProposals ?? []) {
    // Remaining draft rows die with the supersede; accepted rows (is_draft
    // already false) keep their proposal_id for provenance and are untouched.
    const deletes = [
      db.from('shift_assignments').delete().eq('proposal_id', prior.id).eq('is_draft', true),
      db.from('shifts').delete().eq('proposal_id', prior.id).eq('is_draft', true),
      db
        .from('schedule_proposals')
        .update({ status: 'superseded', decided_at: new Date().toISOString() })
        .eq('id', prior.id),
    ];
    for (const op of deletes) {
      const { error } = await op;
      if (error) return json({ error: error.message }, 500);
    }
  }

  // --- Write the batch ---
  const { data: proposal, error: proposalError } = await db
    .from('schedule_proposals')
    .insert({
      week_start: weekStart,
      status: 'draft',
      rationale,
      summary,
      source,
      agent_session_id: agentSessionId,
    })
    .select('id')
    .single();
  if (proposalError) return json({ error: proposalError.message }, 500);
  const proposalId = proposal.id as string;

  const shiftIdByKey = new Map<string, string>();
  for (const draft of draftShifts) {
    const { data, error } = await db
      .from('shifts')
      .insert({
        ...draft.columns,
        source: 'manual',
        proposal_id: proposalId,
        is_draft: true,
      })
      .select('id')
      .single();
    if (error) return json({ error: error.message }, 500);
    shiftIdByKey.set(draft.key, data.id as string);
  }

  if (draftAssignments.length > 0) {
    const { error } = await db.from('shift_assignments').insert(
      draftAssignments.map((a) => ({
        shift_id: a.shiftId ?? (shiftIdByKey.get(a.shiftKey as string) as string),
        staff_id: a.staffId,
        starts_at: a.startsAt,
        ends_at: a.endsAt,
        role: (a.columns.role as string) ?? 'full',
        notes: (a.columns.notes as string | null) ?? null,
        proposal_id: proposalId,
        is_draft: true,
      }))
    );
    if (error) return json({ error: error.message }, 500);
  }

  return json(
    {
      ok: true,
      proposalId,
      weekStart,
      shifts: draftShifts.length,
      assignments: draftAssignments.length,
      conflicts,
    },
    201
  );
};

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
