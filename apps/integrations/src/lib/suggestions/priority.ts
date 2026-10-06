// How urgent a suggested task is, and the due date that follows from it.
// Severity is how bad the problem is if nobody acts; importance is how much
// the work matters to the business. Together they pick a number of days from
// the grid on /admin/settings (`suggestions.dueDays`), counted from the day
// the task is suggested — or from today, when an admin changes either in the
// editor. Pure and client-bundle-safe.

import { addDays } from '@pyre/schedule-core';

export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export const IMPORTANCES = ['high', 'medium', 'low'] as const;

export type Severity = (typeof SEVERITIES)[number];
export type Importance = (typeof IMPORTANCES)[number];

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const IMPORTANCE_LABELS: Record<Importance, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/** Days until due, by severity then importance; null leaves the task undated. */
export type DueDays = Record<Severity, Record<Importance, number | null>>;

/** The most days a cell may hold: about a year. */
export const MAX_DUE_DAYS = 365;

export const DEFAULT_DUE_DAYS: DueDays = {
  critical: { high: 0, medium: 1, low: 2 },
  high: { high: 1, medium: 3, low: 7 },
  medium: { high: 3, medium: 7, low: 14 },
  low: { high: 7, medium: 14, low: 30 },
};

export function isSeverity(value: unknown): value is Severity {
  return typeof value === 'string' && (SEVERITIES as readonly string[]).includes(value);
}

export function isImportance(value: unknown): value is Importance {
  return typeof value === 'string' && (IMPORTANCES as readonly string[]).includes(value);
}

/** A grid as saved, checked cell by cell; every cell must be there. */
export function parseDueDays(
  raw: unknown
): { ok: true; value: DueDays } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Due days must be a grid of severity by importance' };
  }
  const grid = raw as Record<string, unknown>;
  const out = {} as DueDays;
  for (const severity of SEVERITIES) {
    const row = grid[severity];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return { ok: false, error: `Due days needs a row for ${SEVERITY_LABELS[severity]} severity` };
    }
    out[severity] = {} as Record<Importance, number | null>;
    for (const importance of IMPORTANCES) {
      const cell = (row as Record<string, unknown>)[importance];
      if (cell === null) {
        out[severity][importance] = null;
        continue;
      }
      if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 0 || cell > MAX_DUE_DAYS) {
        return {
          ok: false,
          error: `${SEVERITY_LABELS[severity]} severity, ${IMPORTANCE_LABELS[importance]} importance must be 0–${MAX_DUE_DAYS} days, or blank`,
        };
      }
      out[severity][importance] = cell;
    }
  }
  return { ok: true, value: out };
}

/**
 * The due date for a severity and an importance, counted from `from`
 * (YYYY-MM-DD). One without the other reads the missing one as medium;
 * neither, or a blank cell, is no due date.
 */
export function dueDateFor(
  severity: Severity | null,
  importance: Importance | null,
  grid: DueDays,
  from: string
): string | null {
  if (!severity && !importance) return null;
  const days = grid[severity ?? 'medium'][importance ?? 'medium'];
  return days === null ? null : addDays(from, days);
}

/** "Due today", "Due in 3 days", or "No due date", for the editor's hint. */
export function describeDueDays(days: number | null): string {
  if (days === null) return 'No due date';
  if (days === 0) return 'Due the same day';
  return `Due in ${days} day${days === 1 ? '' : 's'}`;
}
