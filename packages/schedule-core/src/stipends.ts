// Stipend hours: recurring weekly extra pay for off-schedule work ("inventory
// & towel ordering, 1h/week"), folded into the Mon–Sun rollup the hours
// report is built from. A stipend applies to every Monday week inside its
// effective range; an override row replaces its hours for one week (0 =
// skipped). Pure functions, pinned down in stipends.test.ts.

import { addDays, weekStartOf, type WeekHours } from './hours';
import type { StaffStipendRow, StipendOverrideRow } from './types';

/**
 * A stipend's hours for one Monday-start week: 0 outside its effective
 * range; inside it, the override's hours when one exists, else the default.
 */
export function stipendWeekHours(
  stipend: StaffStipendRow,
  weekStart: string,
  override?: StipendOverrideRow
): number {
  if (weekStart < stipend.effective_from) return 0;
  if (stipend.effective_until !== null && weekStart > stipend.effective_until) return 0;
  return override ? override.hours : stipend.hours_per_week;
}

/** staffId -> total stipend hours for one Monday-start week (zero rows omitted). */
export function stipendHoursForWeek(
  stipends: StaffStipendRow[],
  overrides: StipendOverrideRow[],
  weekStart: string
): Record<string, number> {
  const byStaff: Record<string, number> = {};
  for (const stipend of stipends) {
    const override = overrides.find(
      (o) => o.stipend_id === stipend.id && o.week_start === weekStart
    );
    const hours = stipendWeekHours(stipend, weekStart, override);
    if (hours > 0) byStaff[stipend.staff_id] = (byStaff[stipend.staff_id] ?? 0) + hours;
  }
  return byStaff;
}

/**
 * Fold stipend hours into a rollupHours() result for every Monday week the
 * picked range touches. Weeks gain hours in byStaff/total (so amounts due and
 * pay periods price them with no further changes), keep the stipend portion
 * separately in stipendByStaff for display, and get founderShare recomputed
 * over the merged totals. Weeks with stipend hours but no assignments are
 * created (empty days). Input weeks are not mutated.
 */
export function applyStipends(
  weeks: WeekHours[],
  stipends: StaffStipendRow[],
  overrides: StipendOverrideRow[],
  founderIds: Set<string>,
  rangeStart: string,
  rangeEnd: string
): WeekHours[] {
  const byWeek = new Map<string, WeekHours>(weeks.map((w) => [w.weekStart, w]));

  const lastWeek = weekStartOf(rangeEnd);
  for (let ws = weekStartOf(rangeStart); ws <= lastWeek; ws = addDays(ws, 7)) {
    const stipendByStaff = stipendHoursForWeek(stipends, overrides, ws);
    if (Object.keys(stipendByStaff).length === 0) continue;

    const week = byWeek.get(ws) ?? {
      weekStart: ws,
      days: [],
      byStaff: {},
      total: 0,
      founderShare: null,
    };
    const byStaff = { ...week.byStaff };
    let total = week.total;
    for (const [staffId, hours] of Object.entries(stipendByStaff)) {
      byStaff[staffId] = (byStaff[staffId] ?? 0) + hours;
      total += hours;
    }
    const founderHours = Object.entries(byStaff)
      .filter(([staffId]) => founderIds.has(staffId))
      .reduce((a, [, hours]) => a + hours, 0);

    byWeek.set(ws, {
      ...week,
      byStaff,
      total,
      founderShare: total > 0 ? founderHours / total : null,
      stipendByStaff,
    });
  }

  return [...byWeek.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}
