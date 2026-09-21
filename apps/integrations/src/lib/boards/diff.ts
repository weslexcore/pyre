// Turning a patch into audit lines. Pure and client-safe, so the activity
// feed can render an optimistic event in the same words the server will write.
//
// One event per concern, not one per column: moving a card and reassigning it
// in the same save produce a `moved` and an `assigned`, because those are two
// different things to have happened and a reader wants them separately.
// Everything without a concern of its own — the title, the notes, the area,
// the waiting-on badge, a card's field answers — collapses into a single
// `updated` carrying each change. And a patch that changes nothing produces
// nothing: re-saving a card you didn't edit should not fill its history.

import type { BoardCardRow, BoardEventAction, GoalRow } from '@/lib/db';
import type { CardPatch } from './validate';

export interface FieldChange {
  from: unknown;
  to: unknown;
}

/** `{ field: { from, to } }` for every key the patch actually changes. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  patch: Partial<T>,
  keys: readonly (keyof T & string)[]
): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {};
  for (const key of keys) {
    if (!(key in patch)) continue;
    const to = patch[key];
    const from = before[key];
    if (same(from, to)) continue;
    changes[key] = { from: from ?? null, to: to ?? null };
  }
  return changes;
}

/** Value equality deep enough for the shapes a card holds. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => same(item, b[index]));
  }
  if (typeof a === 'object' && typeof b === 'object' && b !== null) {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) if (!same(left[key], right[key])) return false;
    return true;
  }
  return false;
}

/** One line waiting to be written. */
export interface PendingEvent {
  action: BoardEventAction;
  detail: Record<string, unknown>;
}

// Changes that get an event of their own, and the ones that ride along in a
// single `updated`.
const CARD_NOTABLE = {
  column_id: 'moved',
  owner_email: 'assigned',
  due_date: 'due_changed',
} as const;

const CARD_REST = ['title', 'notes_md', 'waiting_on', 'area', 'goal_id', 'properties'] as const;

export function eventsForCardPatch(
  before: Pick<BoardCardRow, (typeof CARD_REST)[number] | keyof typeof CARD_NOTABLE>,
  patch: CardPatch
): PendingEvent[] {
  const events: PendingEvent[] = [];
  const record = before as unknown as Record<string, unknown>;

  for (const [field, action] of Object.entries(CARD_NOTABLE) as [
    keyof typeof CARD_NOTABLE,
    BoardEventAction,
  ][]) {
    const changes = diffFields(record, patch as Record<string, unknown>, [field]);
    if (changes[field]) events.push({ action, detail: changes });
  }

  const rest = diffFields(record, patch as Record<string, unknown>, CARD_REST);
  if (Object.keys(rest).length > 0) events.push({ action: 'updated', detail: rest });

  return events;
}

const GOAL_NOTABLE = {
  status: 'status_changed',
  owner_email: 'assigned',
  target_date: 'due_changed',
} as const;

const GOAL_REST = ['title', 'description_md', 'area', 'parent_id'] as const;

/**
 * The same split for a goal. Completion is not here: the route logs a
 * `completed` event of its own carrying the preview the founder confirmed
 * against, which is worth more than "status: active -> completed".
 */
export function eventsForGoalPatch(
  before: Pick<GoalRow, (typeof GOAL_REST)[number] | keyof typeof GOAL_NOTABLE>,
  patch: Record<string, unknown>
): PendingEvent[] {
  const events: PendingEvent[] = [];
  const record = before as unknown as Record<string, unknown>;

  for (const [field, action] of Object.entries(GOAL_NOTABLE) as [
    keyof typeof GOAL_NOTABLE,
    BoardEventAction,
  ][]) {
    const changes = diffFields(record, patch, [field]);
    if (changes[field]) events.push({ action, detail: changes });
  }

  const rest = diffFields(record, patch, GOAL_REST);
  if (Object.keys(rest).length > 0) events.push({ action: 'updated', detail: rest });

  return events;
}
