// Local-first checklist state. A tap flips the box on screen immediately; the
// server hears about it afterwards through SopDocument's serialized queue.
// These helpers are the pure half: apply a tap to the run state, and undo it
// if the server refuses. Client-bundle-safe (no db/env imports).

import type { SopRow, SopRunCheckRow, SopRunRow } from '@/lib/db';

export type CheckItems = { itemIndex: number; itemText: string }[];

export interface RunState {
  run: SopRunRow;
  checks: SopRunCheckRow[];
  /** The document text the run renders against (its pinned snapshot). */
  content: string;
}

/** Ids of check rows that exist only on this screen so far. */
export const LOCAL_ID_PREFIX = 'local:';

/** Whether the run row has been created on the server (an empty id hasn't). */
export function isPersisted(run: SopRunRow): boolean {
  return run.id !== '';
}

/**
 * A run row for the first tap, before the server has created one. The empty
 * id is the marker: the queue sends the start request when it sees it.
 */
export function pendingRun(
  sop: Pick<SopRow, 'id' | 'current_version'>,
  taskCount: number,
  email: string,
  nowIso: string
): SopRunRow {
  return {
    id: '',
    sop_id: sop.id,
    sop_version: sop.current_version,
    task_count: taskCount,
    status: 'in_progress',
    started_by: email,
    started_at: nowIso,
    ended_by: null,
    ended_at: null,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

function byIndex(a: SopRunCheckRow, b: SopRunCheckRow): number {
  return a.item_index - b.item_index;
}

/**
 * Check `items` (a parent tap carries its subtree). Items already checked —
 * by a teammate, or by an earlier tap — are left alone; `added` lists the
 * indexes this tap actually introduced, for `revertCheck`.
 */
export function applyCheck(
  state: RunState,
  items: CheckItems,
  email: string,
  nowIso: string
): { next: RunState; added: number[] } {
  const have = new Set(state.checks.map((c) => c.item_index));
  const added: number[] = [];
  const rows: SopRunCheckRow[] = [];
  for (const item of items) {
    if (have.has(item.itemIndex)) continue;
    have.add(item.itemIndex);
    added.push(item.itemIndex);
    rows.push({
      id: `${LOCAL_ID_PREFIX}${item.itemIndex}`,
      run_id: state.run.id,
      item_index: item.itemIndex,
      item_text: item.itemText,
      checked_by: email,
      checked_at: nowIso,
    });
  }
  if (rows.length === 0) return { next: state, added };
  return { next: { ...state, checks: [...state.checks, ...rows].sort(byIndex) }, added };
}

/** Uncheck one item; `removed` is the row taken out, for `revertUncheck`. */
export function applyUncheck(
  state: RunState,
  itemIndex: number
): { next: RunState; removed: SopRunCheckRow | null } {
  const removed = state.checks.find((c) => c.item_index === itemIndex) ?? null;
  if (!removed) return { next: state, removed: null };
  return {
    next: { ...state, checks: state.checks.filter((c) => c.item_index !== itemIndex) },
    removed,
  };
}

export function revertCheck(state: RunState, added: number[]): RunState {
  if (added.length === 0) return state;
  const drop = new Set(added);
  return { ...state, checks: state.checks.filter((c) => !drop.has(c.item_index)) };
}

export function revertUncheck(state: RunState, removed: SopRunCheckRow): RunState {
  if (state.checks.some((c) => c.item_index === removed.item_index)) return state;
  return { ...state, checks: [...state.checks, removed].sort(byIndex) };
}

/** What the runs API answers with after a start, check, or lookup. */
export interface RunResponseBody {
  run: SopRunRow | null;
  checks?: SopRunCheckRow[];
  content?: string;
}

/**
 * The two pieces of run state the queue carries between ops: what's on
 * screen, and the last state that held a run (after an optimistic "nothing
 * checked, run gone" a queued uncheck still needs the run's id).
 */
export interface RunRefs {
  run: RunState | null;
  last: RunState | null;
}

/**
 * Adopt a server response. The run row is always taken (after the first start
 * it's how the real id arrives); the checks only when this is the last queued
 * op — an earlier response would otherwise erase taps the server hasn't seen
 * yet. Returns the next screen state and the next remembered run; `last`
 * follows every non-null `run`.
 */
export function reconcileRun(
  refs: RunRefs,
  body: RunResponseBody,
  isLastQueued: boolean,
  fallbackContent: string
): RunRefs {
  const current = refs.run;

  if (!body.run) {
    // The server has no run (it auto-discarded after an uncheck).
    if (!current) return { run: null, last: null };
    if (current.checks.length === 0) return { run: null, last: null };
    if (isPersisted(current.run)) {
      // Taps since then re-checked items: the next op starts afresh.
      const next = { ...current, run: { ...current.run, id: '' } };
      return { run: next, last: next };
    }
    return refs;
  }

  if (!current) {
    // Locally nothing is checked (an uncheck is queued, or just landed). Show
    // the server's run only when it's the final word and holds a teammate's
    // checks; otherwise just remember its id for the queue.
    const adopted: RunState = {
      run: body.run,
      checks: isLastQueued ? (body.checks ?? []) : [],
      content: body.content ?? refs.last?.content ?? fallbackContent,
    };
    if (isLastQueued && adopted.checks.length > 0) return { run: adopted, last: adopted };
    return { run: null, last: adopted };
  }

  const next: RunState = {
    run: body.run,
    checks: isLastQueued && body.checks ? body.checks : current.checks,
    content: body.content ?? current.content,
  };
  return { run: next, last: next };
}
