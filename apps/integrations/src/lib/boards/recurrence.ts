// A card that comes back: "every 2 weeks", "monthly". Pure and client-safe —
// the drawer shows the next date with the same arithmetic the route uses to
// file it.
//
// The rule lives on the card (board_cards.repeat_every / repeat_unit). When a
// repeating card is finished, the route files the next one due on
// nextRepeatDate and hands the rule to it (lib/boards/repeat-card.ts); the
// finished card stops repeating, so it can be pulled back out of Done without
// leaving a second copy behind.

import type { BoardCardRow } from '@/lib/db';

export const REPEAT_UNITS = ['day', 'week', 'month', 'year'] as const;
export type RepeatUnit = (typeof REPEAT_UNITS)[number];

export interface RepeatRule {
  every: number;
  unit: RepeatUnit;
}

/** The longest gap a rule may have, in units. Mirrors the column's check. */
export const REPEAT_EVERY_MAX = 365;

export function isRepeatUnit(value: unknown): value is RepeatUnit {
  return typeof value === 'string' && (REPEAT_UNITS as readonly string[]).includes(value);
}

/** The card's rule, or null when it does not repeat. */
export function repeatRuleOf(
  card: Pick<BoardCardRow, 'repeat_every' | 'repeat_unit'>
): RepeatRule | null {
  if (!card.repeat_every || !card.repeat_unit) return null;
  return { every: card.repeat_every, unit: card.repeat_unit };
}

/** The choices the drawer offers before "Custom". */
export const REPEAT_PRESETS: { label: string; rule: RepeatRule }[] = [
  { label: 'Daily', rule: { every: 1, unit: 'day' } },
  { label: 'Weekly', rule: { every: 1, unit: 'week' } },
  { label: 'Every 2 weeks', rule: { every: 2, unit: 'week' } },
  { label: 'Monthly', rule: { every: 1, unit: 'month' } },
  { label: 'Every 3 months', rule: { every: 3, unit: 'month' } },
  { label: 'Yearly', rule: { every: 1, unit: 'year' } },
];

const SINGULAR: Record<RepeatUnit, string> = {
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
  year: 'Yearly',
};

/** "Weekly", "Every 2 weeks". */
export function describeRepeat(rule: RepeatRule): string {
  if (rule.every === 1) return SINGULAR[rule.unit];
  return `Every ${rule.every} ${rule.unit}s`;
}

function parseYmd(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.split('-').map(Number);
  return [y, m, d];
}

function formatYmd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * One step of a rule from `ymd`. Months and years keep the day of the month,
 * clamped to the month's length (Jan 31 → Feb 28); a date on the last day of
 * its month stays on the last day, so a month-end task does not drift to the
 * 28th after one February.
 */
export function addInterval(ymd: string, rule: RepeatRule): string {
  const [y, m, d] = parseYmd(ymd);
  if (rule.unit === 'day' || rule.unit === 'week') {
    const days = rule.every * (rule.unit === 'week' ? 7 : 1);
    const next = new Date(Date.UTC(y, m - 1, d + days));
    return formatYmd(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  }
  const months = rule.every * (rule.unit === 'year' ? 12 : 1);
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  const monthEnd = d === daysInMonth(y, m);
  const nd = monthEnd ? daysInMonth(ny, nm) : Math.min(d, daysInMonth(ny, nm));
  return formatYmd(ny, nm, nd);
}

/**
 * The date the next copy is due: one step on from this one's due date (or
 * from today, for a card that was never dated), and then on again until it
 * is after today — finishing a weekly task three weeks late files next
 * week's, not three overdue ones.
 */
export function nextRepeatDate(dueDate: string | null, rule: RepeatRule, today: string): string {
  let next = addInterval(dueDate ?? today, rule);
  // Bounded: a daily rule from a date years back is still a few thousand steps.
  for (let i = 0; next <= today && i < 20000; i++) next = addInterval(next, rule);
  return next;
}
