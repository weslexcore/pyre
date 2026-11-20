// Pyre Agent and schedule drafts, for someone who manages the schedule: read
// the week's open draft item by item, start a draft or ask for a revision
// (lib/schedule/draft-run, the same run the board's buttons make), and
// propose which items to confirm or drop. A confirmation is a pending
// schedule.review action like any other Pyre Agent proposal: nothing goes
// live until the person presses Apply, which replays the board's own review
// calls (/api/admin/schedule-proposals) as them — so the same rules, change
// log and staff notifications apply as if they had clicked ✓ on the board.
// Server-only.

import { addDays, dutyLabel } from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DRAFT_REQUEST_LAPSE_MS, isWeekStart, scheduleWeekHref } from '@/lib/schedule/draft-run';
import { loadDutyCatalog } from '@/lib/schedule/duties';
import type { ApplyStep } from './types';

export const SCHEDULE_REVIEW_API = '/api/admin/schedule-proposals';

export type DraftItemKind = 'shift' | 'assignment' | 'duty';

/** One draft row as the agent and the confirmation card see it. */
export interface DraftItem {
  /** "assignment:<uuid>", "shift:<uuid>", or "duty:<uuid>" — what the agent names in a review. */
  ref: string;
  kind: DraftItemKind;
  date: string;
  /** One line: "Sat Nov 28 · Evening 4:00–9:00pm · Sarah Lee (Host, Set Up A)". */
  line: string;
  /** For an assignment: the person. */
  person?: string;
  /** For an assignment: the draft shift it sits on, when that shift is also new. */
  newShiftRef?: string;
}

export interface ScheduleDraftView {
  weekStart: string;
  url: string;
  /** A draft or revision someone asked for that has not produced a proposal yet. */
  inProgress: { kind: 'draft' | 'refine'; since: string; requestedBy: string } | null;
  draft: {
    proposalId: string;
    createdAt: string;
    rationale: string;
    uncoveredShifts: number;
    warnings: string[];
    items: DraftItem[];
  } | null;
  /** The week's latest decided proposal, when there is no open one. */
  last: { status: string; decidedAt: string | null } | null;
}

function fmtTime(value: string): string {
  const [h, m] = value.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')}${suffix}`;
}

function fmtDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function parseRef(ref: string): { kind: DraftItemKind; id: string } | null {
  const match = /^(shift|assignment|duty):([0-9a-f-]{36})$/i.exec(ref.trim());
  return match
    ? { kind: match[1].toLowerCase() as DraftItemKind, id: match[2].toLowerCase() }
    : null;
}

/** The week's open draft (if any), every item in it, and whether a run is still going. */
export async function loadScheduleDraft(
  db: SupabaseClient,
  weekStart: string
): Promise<ScheduleDraftView> {
  const view: ScheduleDraftView = {
    weekStart,
    url: scheduleWeekHref(weekStart),
    inProgress: null,
    draft: null,
    last: null,
  };

  const [{ data: proposals }, { data: requests }] = await Promise.all([
    db
      .from('schedule_proposals')
      .select('id, status, rationale, summary, created_at, decided_at')
      .eq('week_start', weekStart)
      .neq('status', 'superseded')
      .order('created_at', { ascending: false })
      .limit(1),
    db
      .from('schedule_draft_requests')
      .select('kind, created_at, requested_by')
      .eq('week_start', weekStart)
      .is('completed_at', null)
      .gt('created_at', new Date(Date.now() - DRAFT_REQUEST_LAPSE_MS).toISOString())
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  const pending = (requests ?? [])[0] as
    | { kind: 'draft' | 'refine'; created_at: string; requested_by: string }
    | undefined;
  if (pending) {
    view.inProgress = {
      kind: pending.kind,
      since: pending.created_at,
      requestedBy: pending.requested_by,
    };
  }

  const proposal = (proposals ?? [])[0] as
    | {
        id: string;
        status: string;
        rationale: string | null;
        summary: Record<string, unknown> | null;
        created_at: string;
        decided_at: string | null;
      }
    | undefined;
  if (!proposal) return view;
  if (proposal.status !== 'draft') {
    view.last = { status: proposal.status, decidedAt: proposal.decided_at };
    return view;
  }

  const [{ data: shifts }, { data: assignments }, { data: duties }, catalog] = await Promise.all([
    db
      .from('shifts')
      .select('id, shift_date, label, starts_at, ends_at, staff_needed')
      .eq('proposal_id', proposal.id)
      .eq('is_draft', true),
    db
      .from('shift_assignments')
      .select('id, shift_id, staff_id, starts_at, ends_at, duties')
      .eq('proposal_id', proposal.id)
      .eq('is_draft', true),
    db
      .from('duty_assignments')
      .select('id, duty_key, duty_date, staff_id')
      .eq('proposal_id', proposal.id)
      .eq('is_draft', true),
    loadDutyCatalog(db),
  ]);

  type Shift = {
    id: string;
    shift_date: string;
    label: string;
    starts_at: string;
    ends_at: string;
    staff_needed: number;
  };
  const draftShifts = (shifts ?? []) as Shift[];
  const draftAssignments = (assignments ?? []) as {
    id: string;
    shift_id: string;
    staff_id: string;
    starts_at: string;
    ends_at: string;
    duties: string[] | null;
  }[];
  const draftDuties = (duties ?? []) as {
    id: string;
    duty_key: string;
    duty_date: string;
    staff_id: string;
  }[];

  // The live shifts the draft assigns people onto, and everyone it names.
  const draftShiftIds = new Set(draftShifts.map((s) => s.id));
  const liveShiftIds = [
    ...new Set(draftAssignments.map((a) => a.shift_id).filter((id) => !draftShiftIds.has(id))),
  ];
  const staffIds = [
    ...new Set([...draftAssignments.map((a) => a.staff_id), ...draftDuties.map((d) => d.staff_id)]),
  ];
  const [{ data: liveShifts }, { data: staff }] = await Promise.all([
    liveShiftIds.length
      ? db
          .from('shifts')
          .select('id, shift_date, label, starts_at, ends_at, staff_needed')
          .in('id', liveShiftIds)
      : Promise.resolve({ data: [] }),
    staffIds.length
      ? db.from('staff').select('id, display_name').in('id', staffIds)
      : Promise.resolve({ data: [] }),
  ]);
  const shiftById = new Map<string, Shift>();
  for (const s of [...draftShifts, ...((liveShifts ?? []) as Shift[])]) shiftById.set(s.id, s);
  const nameById = new Map(
    ((staff ?? []) as { id: string; display_name: string }[]).map((s) => [s.id, s.display_name])
  );

  const items: DraftItem[] = [];
  for (const s of draftShifts) {
    items.push({
      ref: `shift:${s.id}`,
      kind: 'shift',
      date: s.shift_date,
      line: `${fmtDay(s.shift_date)} · new shift ${s.label} ${fmtTime(s.starts_at)}–${fmtTime(s.ends_at)} (needs ${s.staff_needed})`,
    });
  }
  for (const a of draftAssignments) {
    const shift = shiftById.get(a.shift_id);
    const person = nameById.get(a.staff_id) ?? 'Unknown person';
    const jobs = (a.duties ?? []).map((key) => dutyLabel(catalog, key));
    items.push({
      ref: `assignment:${a.id}`,
      kind: 'assignment',
      date: shift?.shift_date ?? '',
      person,
      line: `${shift ? `${fmtDay(shift.shift_date)} · ${shift.label}` : 'Unknown shift'} ${fmtTime(a.starts_at)}–${fmtTime(a.ends_at)} · ${person}${jobs.length ? ` (${jobs.join(', ')})` : ''}`,
      ...(draftShiftIds.has(a.shift_id) ? { newShiftRef: `shift:${a.shift_id}` } : {}),
    });
  }
  for (const d of draftDuties) {
    items.push({
      ref: `duty:${d.id}`,
      kind: 'duty',
      date: d.duty_date,
      person: nameById.get(d.staff_id) ?? 'Unknown person',
      line: `${fmtDay(d.duty_date)} · ${dutyLabel(catalog, d.duty_key)} (off-shift) · ${nameById.get(d.staff_id) ?? 'Unknown person'}`,
    });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || a.line.localeCompare(b.line));

  const summary = proposal.summary ?? {};
  view.draft = {
    proposalId: proposal.id,
    createdAt: proposal.created_at,
    rationale: proposal.rationale ?? '',
    uncoveredShifts: Number(summary.uncoveredShifts ?? 0) || 0,
    warnings: Array.isArray(summary.warnings)
      ? summary.warnings.filter((w): w is string => typeof w === 'string')
      : [],
    items,
  };
  return view;
}

type Checked =
  | {
      ok: true;
      proposal: {
        summary: string;
        details: string[];
        steps: ApplyStep[];
        target: { label: string; href: string };
      };
    }
  | { ok: false; error: string };

/**
 * Check a review the agent proposes against the week's open draft and turn
 * it into the board's own calls: approve (the whole draft, in one call — one
 * notice per person, as the board's Approve gives), or accept-item and
 * reject-item per row. `acceptDays` takes every item on those dates.
 */
export async function checkScheduleReview(
  db: SupabaseClient,
  input: Record<string, unknown>
): Promise<Checked> {
  const weekStart = input.weekStart;
  if (!isWeekStart(weekStart))
    return { ok: false, error: 'weekStart must be a Monday as YYYY-MM-DD' };
  const view = await loadScheduleDraft(db, weekStart);
  if (view.inProgress) {
    return {
      ok: false,
      error:
        'A draft or revision for this week is still being worked on; wait for it to land, then read the draft again',
    };
  }
  const draft = view.draft;
  if (!draft) return { ok: false, error: 'There is no open draft for that week' };
  if (draft.items.length === 0)
    return { ok: false, error: 'The open draft has nothing left to review' };

  const target = { label: `Draft for the week of ${fmtDay(weekStart)}`, href: view.url };
  const marker: ApplyStep = {
    method: 'POST',
    path: SCHEDULE_REVIEW_API,
    body: { action: 'check-open', proposalId: draft.proposalId },
  };

  if (input.acceptAll === true) {
    const people = new Set(draft.items.map((i) => i.person).filter(Boolean));
    return {
      ok: true,
      proposal: {
        summary: `Approve the whole draft for the week of ${fmtDay(weekStart)}: ${draft.items.length} item${draft.items.length === 1 ? '' : 's'}, ${people.size} ${people.size === 1 ? 'person' : 'people'}`,
        details: draft.items.map((i) => i.line).slice(0, 60),
        steps: [{ ...marker, body: { action: 'approve', proposalId: draft.proposalId } }],
        target,
      },
    };
  }

  const byRef = new Map(draft.items.map((i) => [i.ref, i]));
  const pick = (raw: unknown, field: string): DraftItem[] | string => {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) return `${field} must be a list of item refs`;
    const out: DraftItem[] = [];
    for (const value of raw) {
      const parsed = typeof value === 'string' ? parseRef(value) : null;
      const item = parsed ? byRef.get(`${parsed.kind}:${parsed.id}`) : undefined;
      if (!item) {
        return `"${String(value)}" is not an item in the open draft; read it again with get_schedule_draft`;
      }
      if (!out.includes(item)) out.push(item);
    }
    return out;
  };

  const accept = pick(input.accept, 'accept');
  if (typeof accept === 'string') return { ok: false, error: accept };
  const reject = pick(input.reject, 'reject');
  if (typeof reject === 'string') return { ok: false, error: reject };

  if (input.acceptDays !== undefined) {
    if (!Array.isArray(input.acceptDays))
      return { ok: false, error: 'acceptDays must be a list of dates' };
    const weekEnd = addDays(weekStart, 6);
    for (const day of input.acceptDays) {
      if (typeof day !== 'string' || day < weekStart || day > weekEnd) {
        return { ok: false, error: `"${String(day)}" is not a day of the week of ${weekStart}` };
      }
      for (const item of draft.items) {
        if (item.date === day && !accept.includes(item)) accept.push(item);
      }
    }
  }

  const clash = accept.find((i) => reject.includes(i));
  if (clash) return { ok: false, error: `${clash.ref} is in both accept and reject` };
  // Rejecting a new shift takes its people with it; accepting one of them
  // would put them back on a shift that is gone.
  const rejectedShifts = new Set(reject.filter((i) => i.kind === 'shift').map((i) => i.ref));
  const orphan = accept.find((i) => i.newShiftRef && rejectedShifts.has(i.newShiftRef));
  if (orphan) {
    return {
      ok: false,
      error: `${orphan.ref} sits on a new shift you are rejecting; reject it too or keep the shift`,
    };
  }
  if (accept.length + reject.length === 0) {
    return {
      ok: false,
      error: 'Name something to confirm or drop: acceptAll, acceptDays, accept, or reject',
    };
  }

  const steps: ApplyStep[] = [marker];
  for (const item of accept) {
    steps.push({
      method: 'POST',
      path: SCHEDULE_REVIEW_API,
      body: { action: 'accept-item', kind: item.kind, id: item.ref.split(':')[1] },
    });
  }
  // Rejected assignments before their shifts, so nothing is deleted twice.
  const rejectOrder = [...reject].sort(
    (a, b) => (a.kind === 'shift' ? 1 : 0) - (b.kind === 'shift' ? 1 : 0)
  );
  for (const item of rejectOrder) {
    steps.push({
      method: 'POST',
      path: SCHEDULE_REVIEW_API,
      body: { action: 'reject-item', kind: item.kind, id: item.ref.split(':')[1] },
    });
  }

  const left = draft.items.length - accept.length - reject.length;
  const parts = [
    accept.length ? `confirm ${accept.length}` : null,
    reject.length ? `drop ${reject.length}` : null,
  ].filter(Boolean);
  return {
    ok: true,
    proposal: {
      summary: `Week of ${fmtDay(weekStart)}: ${parts.join(' and ')} of ${draft.items.length} draft item${draft.items.length === 1 ? '' : 's'}${left > 0 ? ` (${left} stay in the draft)` : ''}`,
      details: [
        ...accept.map((i) => `Confirm: ${i.line}`),
        ...reject.map((i) => `Drop: ${i.line}`),
      ].slice(0, 80),
      steps,
      target,
    },
  };
}

/**
 * Replay a schedule.review: refuse up front when the draft it was made
 * against is no longer the open one (a revision replaced it, or someone
 * decided it on the board), then run every call and report what did not go.
 */
export async function replayScheduleReview(
  db: SupabaseClient,
  steps: ApplyStep[],
  run: (step: ApplyStep) => Promise<{ status: number; body: Record<string, unknown> }>
): Promise<{ ok: true; failed: number; total: number } | { ok: false; error: string }> {
  const [first, ...rest] = steps;
  const proposalId = String(first?.body.proposalId ?? '');
  const { data } = await db
    .from('schedule_proposals')
    .select('status')
    .eq('id', proposalId)
    .maybeSingle();
  if (data?.status !== 'draft') {
    return {
      ok: false,
      error:
        'That draft is no longer open (it was revised, approved, or discarded since). Ask Pyre Agent to read the draft again.',
    };
  }
  // The marker only names the proposal; an approve is the one real call.
  const calls = first.body.action === 'check-open' ? rest : steps;
  let failed = 0;
  let firstError: string | null = null;
  for (const step of calls) {
    const response = await run(step);
    if (response.status >= 300) {
      failed += 1;
      firstError ??=
        typeof response.body.error === 'string' ? response.body.error : `HTTP ${response.status}`;
    }
  }
  if (failed === calls.length) return { ok: false, error: firstError ?? 'The review failed' };
  return { ok: true, failed, total: calls.length };
}
