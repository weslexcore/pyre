// How long after it is made a new card on a board is due: "2 hours", "1 week".
// Pure and client-safe — the board settings preview the date with the same
// arithmetic the insert trigger (board_cards_default_due) uses to set it.
//
// The rule lives on the board (boards.default_due_every / default_due_unit).
// A card's due date is a day, not a moment, so an hours rule resolves to the
// day the deadline lands on in America/New_York: "2 hours" from 11pm is due
// tomorrow. Days, weeks and months count from today's date there.

import { easternDate } from '@pyre/schedule-core';
import type { BoardRow } from '@/lib/db';

export const DEFAULT_DUE_UNITS = ['hour', 'day', 'week', 'month'] as const;
export type DefaultDueUnit = (typeof DEFAULT_DUE_UNITS)[number];

export interface DefaultDueRule {
  every: number;
  unit: DefaultDueUnit;
}

/** The longest a rule may be, in units. Mirrors the column's check. */
export const DEFAULT_DUE_EVERY_MAX = 365;

export function isDefaultDueUnit(value: unknown): value is DefaultDueUnit {
  return typeof value === 'string' && (DEFAULT_DUE_UNITS as readonly string[]).includes(value);
}

/** The board's rule, or null when new cards start undated. */
export function defaultDueRuleOf(
  board: Pick<BoardRow, 'default_due_every' | 'default_due_unit'>
): DefaultDueRule | null {
  if (!board.default_due_every || !isDefaultDueUnit(board.default_due_unit)) return null;
  return { every: board.default_due_every, unit: board.default_due_unit };
}

/** The choices the settings offer before "Custom". */
export const DEFAULT_DUE_PRESETS: { label: string; rule: DefaultDueRule }[] = [
  { label: '2 hours', rule: { every: 2, unit: 'hour' } },
  { label: '1 day', rule: { every: 1, unit: 'day' } },
  { label: '2 days', rule: { every: 2, unit: 'day' } },
  { label: '1 week', rule: { every: 1, unit: 'week' } },
  { label: '2 weeks', rule: { every: 2, unit: 'week' } },
  { label: '1 month', rule: { every: 1, unit: 'month' } },
];

/** "2 hours", "1 week". */
export function describeDefaultDue(rule: DefaultDueRule): string {
  return `${rule.every} ${rule.every === 1 ? rule.unit : `${rule.unit}s`}`;
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Postgres's date + interval 'n months': the same day, clamped to the month's length. */
function addMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = index % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ny, nm, Math.min(d, last))).toISOString().slice(0, 10);
}

/** The day a card made at `now` is due under `rule`, YYYY-MM-DD in America/New_York. */
export function defaultDueDate(rule: DefaultDueRule, now: Date = new Date()): string {
  if (rule.unit === 'hour') {
    return easternDate(new Date(now.getTime() + rule.every * 60 * 60 * 1000));
  }
  const today = easternDate(now);
  if (rule.unit === 'day') return addDays(today, rule.every);
  if (rule.unit === 'week') return addDays(today, rule.every * 7);
  return addMonths(today, rule.every);
}
