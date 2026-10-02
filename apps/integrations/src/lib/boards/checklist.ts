// The checklist board field: a list a card works through, written in the
// same markdown as the SOP library (lib/sops/checklist.ts parses both) —
// `- [ ]` for an item, `- [!]` for one that must be completed and can never
// be skipped. Pure and client-bundle-safe: the drawer, the row and the card
// route all read the same rules.
//
// A card's answer is { md, checks }: its own copy of the list and one entry
// per resolved item. Before anybody touches it there is no answer and the
// card reads the field's default (checklistOf); the first tap stores a copy,
// so editing the default later never shifts the items under a card that is
// halfway through. An item is found again by index *and* text, so a card
// whose list was edited keeps the marks on the items that are still there
// and drops the ones that are not, rather than ticking whatever moved into
// their place.
//
// Who resolved an item and when are the route's to write (stampChecklists),
// from the session: a request can say an item is done, never who did it.
//
// A field can name a column the card moves to the moment its checklist is
// finished — every item resolved, every required one completed — which is
// how "onboarding done" becomes "Active" without anybody dragging the card.

import type {
  BoardColumnRow,
  BoardFieldRow,
  BoardFieldValue,
  ChecklistAnswer,
  ChecklistAnswerCheck,
} from '@/lib/db';
import {
  type ChecklistMark,
  type ChecklistTask,
  isChecklistComplete,
  parseChecklist,
} from '@/lib/sops/checklist';
import type { CheckItems } from '@/lib/sops/optimistic';
import { BOARD_LIMITS } from './types';

type ChecklistField = Pick<BoardFieldRow, 'kind' | 'checklist_md'>;

/** A stored answer that has the checklist shape, or null. */
function answerShape(value: unknown): ChecklistAnswer | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const answer = value as Partial<ChecklistAnswer>;
  if (typeof answer.md !== 'string' || !Array.isArray(answer.checks)) return null;
  return answer as ChecklistAnswer;
}

/** The list a card is working through: its own answer, or the field's default. */
export function checklistOf(field: ChecklistField, value: unknown): ChecklistAnswer {
  return answerShape(value) ?? { md: field.checklist_md ?? '', checks: [] };
}

/** The checks that still name an item of `tasks`, by index and text, one per item. */
function matchChecks(
  tasks: ChecklistTask[],
  checks: ChecklistAnswerCheck[]
): ChecklistAnswerCheck[] {
  const byIndex = new Map(tasks.map((task) => [task.index, task]));
  const seen = new Set<number>();
  const kept: ChecklistAnswerCheck[] = [];
  for (const check of checks) {
    const task = byIndex.get(check.i);
    if (!task || task.text !== check.t || seen.has(check.i)) continue;
    // A required item can only be completed. A skip that arrives for one is
    // refused by dropping it — the item stays open — rather than storing a
    // record the checklist would then have to argue with.
    if (task.required && check.s) continue;
    seen.add(check.i);
    kept.push(check);
  }
  return kept.sort((a, b) => a.i - b.i);
}

/**
 * One answer, coerced to the stored shape, or null to clear it. The marks
 * are re-read against the list they arrive with, so nothing can claim an
 * item the list does not have. An emptied list clears the answer, and the
 * card goes back to the field's default.
 */
export function normalizeChecklist(raw: unknown): ChecklistAnswer | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.md !== 'string') return null;
  const md = value.md.replace(/\s+$/, '');
  if (!md.trim() || md.length > BOARD_LIMITS.checklist) return null;

  const checks: ChecklistAnswerCheck[] = [];
  for (const entry of Array.isArray(value.checks) ? value.checks : []) {
    if (!entry || typeof entry !== 'object') continue;
    const check = entry as Record<string, unknown>;
    if (typeof check.i !== 'number' || !Number.isInteger(check.i) || check.i < 0) continue;
    if (typeof check.t !== 'string') continue;
    checks.push({
      i: check.i,
      t: check.t,
      s: check.s === true,
      by: typeof check.by === 'string' ? check.by : '',
      at: typeof check.at === 'string' ? check.at : '',
    });
  }
  return { md, checks: matchChecks(parseChecklist(md).tasks, checks) };
}

/** An answer's checks as the shared Checklist component draws them. */
export function marksOf(answer: ChecklistAnswer): ChecklistMark[] {
  return answer.checks.map((check) => ({
    index: check.i,
    skipped: check.s,
    by: check.by,
    at: check.at,
  }));
}

/**
 * A tap, applied: the items the Checklist reported resolved (or the one
 * un-resolved). `actor` and `now` are the client's guess at the stamp, so
 * the row says who and when straight away; the route writes its own.
 */
export function toggleChecklist(
  answer: ChecklistAnswer,
  items: CheckItems,
  checked: boolean,
  actor: string,
  now: string
): ChecklistAnswer {
  const touched = new Set(items.map((item) => item.itemIndex));
  const rest = answer.checks.filter((check) => !touched.has(check.i));
  if (!checked) return { md: answer.md, checks: rest };
  const added = items.map((item) => ({
    i: item.itemIndex,
    t: item.itemText,
    s: item.skipped === true,
    by: actor,
    at: now,
  }));
  return { md: answer.md, checks: [...rest, ...added].sort((a, b) => a.i - b.i) };
}

/**
 * A card's own copy of the list, rewritten. The marks follow their items by
 * text — the first open item with the same words — so reordering or adding
 * lines keeps what was done, and an item whose words changed starts over.
 */
export function editChecklist(answer: ChecklistAnswer, md: string): ChecklistAnswer {
  const tasks = parseChecklist(md).tasks;
  const claimed = new Set<number>();
  const checks: ChecklistAnswerCheck[] = [];
  for (const check of answer.checks) {
    const task = tasks.find((t) => t.text === check.t && !claimed.has(t.index));
    if (!task || (task.required && check.s)) continue;
    claimed.add(task.index);
    checks.push({ ...check, i: task.index });
  }
  return { md, checks: checks.sort((a, b) => a.i - b.i) };
}

/** Every item resolved and every required one completed. */
export function checklistDone(answer: ChecklistAnswer): boolean {
  return isChecklistComplete(parseChecklist(answer.md).tasks, marksOf(answer));
}

/** "3 of 5" — what a card row shows. '' for a list with no items. */
export function formatChecklist(value: unknown): string {
  const answer = answerShape(value);
  if (!answer) return '';
  const total = parseChecklist(answer.md).tasks.length;
  if (total === 0) return '';
  return checklistDone(answer) ? `${total} of ${total} ✓` : `${answer.checks.length} of ${total}`;
}

/** The items' words, for search. */
export function checklistText(value: unknown): string[] {
  const answer = answerShape(value);
  return answer ? parseChecklist(answer.md).tasks.map((task) => task.text) : [];
}

/**
 * Write the route's own stamp onto every check this save adds or changes:
 * a mark that was already there (same item, same text, same skip) keeps the
 * person and time it was first made with; anything new is `actor`, now.
 */
export function stampChecklists(
  fields: Pick<BoardFieldRow, 'key' | 'kind'>[],
  before: Record<string, BoardFieldValue>,
  after: Record<string, BoardFieldValue>,
  actor: string,
  now: string
): Record<string, BoardFieldValue> {
  let next = after;
  for (const field of fields) {
    if (field.kind !== 'checklist') continue;
    const answer = answerShape(after[field.key]);
    if (!answer) continue;
    const previous = answerShape(before[field.key])?.checks ?? [];
    const checks = answer.checks.map((check) => {
      const kept = previous.find(
        (old) => old.i === check.i && old.t === check.t && old.s === check.s
      );
      return kept ? { ...check, by: kept.by, at: kept.at } : { ...check, by: actor, at: now };
    });
    if (next === after) next = { ...after };
    next[field.key] = { md: answer.md, checks };
  }
  return next;
}

/**
 * The column a save should move the card to because a checklist on it just
 * got finished: one that was not done before and is now, on a field that
 * names a live column of this board. Null when nothing finished, or the
 * field moves nothing, or the card is already there. The first such field
 * in the board's order wins.
 */
export function checklistDestination<C extends Pick<BoardColumnRow, 'id' | 'key' | 'archived'>>(
  fields: Pick<
    BoardFieldRow,
    'key' | 'kind' | 'checklist_md' | 'checklist_done_column' | 'archived'
  >[],
  columns: C[],
  currentColumnId: string,
  before: Record<string, BoardFieldValue | null>,
  after: Record<string, BoardFieldValue | null>
): C | null {
  for (const field of fields) {
    if (field.kind !== 'checklist' || field.archived || !field.checklist_done_column) continue;
    if (after[field.key] === undefined) continue;
    if (!checklistDone(checklistOf(field, after[field.key]))) continue;
    if (checklistDone(checklistOf(field, before[field.key]))) continue;
    const column = columns.find((c) => c.key === field.checklist_done_column && !c.archived);
    if (!column || column.id === currentColumnId) continue;
    return column;
  }
  return null;
}

/** Checklist answers dropped: for writers that are not staff (intake). */
export function withoutChecklists(
  fields: Pick<BoardFieldRow, 'key' | 'kind'>[],
  properties: Record<string, BoardFieldValue>
): Record<string, BoardFieldValue> {
  const keys = fields.filter((field) => field.kind === 'checklist').map((field) => field.key);
  if (!keys.some((key) => key in properties)) return properties;
  const next = { ...properties };
  for (const key of keys) delete next[key];
  return next;
}

/** The emails on a set of cards' checklists, so the board can name them. */
export function checklistPeople(
  fields: Pick<BoardFieldRow, 'key' | 'kind'>[],
  cards: { properties: Record<string, BoardFieldValue> }[]
): string[] {
  const keys = fields.filter((field) => field.kind === 'checklist').map((field) => field.key);
  if (keys.length === 0) return [];
  const emails = new Set<string>();
  for (const card of cards) {
    for (const key of keys) {
      for (const check of answerShape(card.properties[key])?.checks ?? []) {
        if (check.by) emails.add(check.by);
      }
    }
  }
  return [...emails];
}
