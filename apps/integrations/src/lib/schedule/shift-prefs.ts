// A person's scheduling preferences: the h/wk target and the shifts-per-week
// range (min / preferred / max) on their staff row. Edited from the Hours tab
// (/api/admin/staff-preferences) by the person themselves or by a schedule
// manager. Parsing lives here so the rules are the same wherever they're set.

import type { StaffRow } from '@/lib/db';

export type ShiftPrefColumn =
  | 'target_hours_per_week'
  | 'min_shifts_per_week'
  | 'preferred_shifts_per_week'
  | 'max_shifts_per_week';

export type ShiftPrefs = Pick<StaffRow, ShiftPrefColumn>;

type ShiftCountColumn = Exclude<ShiftPrefColumn, 'target_hours_per_week'>;

/** The body keys for the shifts-per-week bounds, with their columns. */
export const SHIFT_COUNT_FIELDS: Array<{
  key: 'minShifts' | 'preferredShifts' | 'maxShifts';
  column: ShiftCountColumn;
  label: string;
  min: number;
}> = [
  { key: 'minShifts', column: 'min_shifts_per_week', label: 'Minimum shifts', min: 0 },
  {
    key: 'preferredShifts',
    column: 'preferred_shifts_per_week',
    label: 'Preferred shifts',
    min: 1,
  },
  { key: 'maxShifts', column: 'max_shifts_per_week', label: 'Maximum shifts', min: 1 },
];

/** Hours/week target: null clears; else finite, >0–168, tenth-hour steps. */
export function parseTargetHours(value: unknown): number | null | { error: string } {
  if (value === null) return null;
  const hours = typeof value === 'number' ? value : Number(String(value));
  if (!Number.isFinite(hours) || hours <= 0 || hours > 168) {
    return { error: 'Target hours must be between 0 and 168 (or empty for no target)' };
  }
  return Math.round(hours * 10) / 10;
}

/** Shifts/week bound: null clears; else a whole number, `min`–14. */
export function parseShiftCount(
  value: unknown,
  label: string,
  min: number
): number | null | { error: string } {
  if (value === null) return null;
  const count = typeof value === 'number' ? value : Number(String(value));
  if (!Number.isInteger(count) || count < min || count > 14) {
    return { error: `${label} must be a whole number from ${min} to 14 (or empty for none)` };
  }
  return count;
}

/**
 * Parse whichever of targetHours / minShifts / preferredShifts / maxShifts
 * the body carries (explicit null clears one) into column updates. Ordering
 * is checked against the row as it will be, so editing one bound can't slip
 * past another that was saved earlier — the table's check would reject it
 * anyway, with a less useful message.
 */
export function parseShiftPrefs(
  body: Record<string, unknown>,
  current: ShiftPrefs
): Partial<ShiftPrefs> | { error: string } {
  const fields: Partial<ShiftPrefs> = {};

  if (body.targetHours !== undefined) {
    const target = parseTargetHours(body.targetHours);
    if (target !== null && typeof target === 'object') return target;
    fields.target_hours_per_week = target;
  }

  for (const { key, column, label, min } of SHIFT_COUNT_FIELDS) {
    if (body[key] === undefined) continue;
    const count = parseShiftCount(body[key], label, min);
    if (count !== null && typeof count === 'object') return count;
    fields[column] = count;
  }

  const bound = (column: ShiftCountColumn) =>
    fields[column] !== undefined ? fields[column] : current[column];
  const [minShifts, preferredShifts, maxShifts] = SHIFT_COUNT_FIELDS.map((f) => bound(f.column));
  const outOfOrder = (low: number | null | undefined, high: number | null | undefined) =>
    low != null && high != null && low > high;
  if (
    outOfOrder(minShifts, preferredShifts) ||
    outOfOrder(preferredShifts, maxShifts) ||
    outOfOrder(minShifts, maxShifts)
  ) {
    return { error: 'Shifts per week must read minimum ≤ preferred ≤ maximum' };
  }

  return fields;
}
