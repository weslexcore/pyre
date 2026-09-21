// What a goal's KPIs are saying: how far each one has come, whether it is met,
// and how long ago anybody checked. Pure and client-safe — the goal page, the
// index cards, and the completion dialog all read the same numbers.
//
// The scale is start -> target, not zero -> target. A KPI that begins at three
// weeks and wants four is 0% done on day one, not 75%: the meter should show
// the distance still to travel, which is the thing a founder is deciding on.

import type { GoalKpiRow } from '@/lib/db';
import type { KpiDirectionValue } from './types';

/** The parts of a KPI the maths needs — so tests don't build whole rows. */
export type KpiInput = Pick<
  GoalKpiRow,
  'direction' | 'start_value' | 'target_value' | 'current_value'
>;

export interface KpiProgress {
  /** 0–100, clamped. 0 when nobody has measured it yet. */
  pct: number;
  met: boolean;
  direction: KpiDirectionValue;
  /** False until somebody puts a number on it. */
  measured: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function kpiProgress(kpi: KpiInput): KpiProgress {
  const direction = kpi.direction;
  const current = kpi.current_value;
  const target = kpi.target_value;

  if (current === null || current === undefined || !Number.isFinite(current)) {
    return { pct: 0, met: false, direction, measured: false };
  }

  const met = direction === 'at_least' ? current >= target : current <= target;

  // The baseline. For "at least", a missing start means we began at nothing.
  // For "at most" there is no such default — starting at zero callouts when
  // you want at most two would read as already past the finish line — so a
  // KPI without one is all-or-nothing rather than wrongly precise.
  const start = kpi.start_value;
  const hasStart = start !== null && start !== undefined && Number.isFinite(start);
  const from = hasStart ? (start as number) : direction === 'at_least' ? 0 : null;
  if (from === null) return { pct: met ? 100 : 0, met, direction, measured: true };

  // A start already at or past the target leaves no distance to measure
  // (someone typed the two the same way round, or the goal was written after
  // the work) — fall back to the same all-or-nothing read.
  const span = direction === 'at_least' ? target - from : from - target;
  if (span <= 0) return { pct: met ? 100 : 0, met, direction, measured: true };

  const travelled = direction === 'at_least' ? current - from : from - current;
  const pct = Math.max(0, Math.min(100, Math.round((travelled / span) * 100)));
  return { pct, met, direction, measured: true };
}

/**
 * Whole days since `current_value` was last set, or null when it never was.
 * A KPI measured six weeks ago is not news, and the page says so rather than
 * letting a stale number pass for today's.
 */
export function kpiFreshness(kpi: Pick<GoalKpiRow, 'measured_at'>, nowIso: string): number | null {
  if (!kpi.measured_at) return null;
  const measured = Date.parse(kpi.measured_at);
  const now = Date.parse(nowIso);
  if (Number.isNaN(measured) || Number.isNaN(now)) return null;
  return Math.max(0, Math.floor((now - measured) / MS_PER_DAY));
}

export interface KpiSummary {
  total: number;
  met: number;
  /** Mean progress across the KPIs, 0–100. 0 when there are none. */
  pct: number;
  /** True when every KPI is met — never enough on its own to close a goal. */
  allMet: boolean;
  /** How many have never been measured. */
  unmeasured: number;
}

/** The one-line read of a goal's KPIs, for an index card or a rollup. */
export function goalKpiSummary(kpis: KpiInput[]): KpiSummary {
  if (kpis.length === 0) {
    return { total: 0, met: 0, pct: 0, allMet: false, unmeasured: 0 };
  }
  let met = 0;
  let unmeasured = 0;
  let sum = 0;
  for (const kpi of kpis) {
    const progress = kpiProgress(kpi);
    if (progress.met) met += 1;
    if (!progress.measured) unmeasured += 1;
    sum += progress.pct;
  }
  return {
    total: kpis.length,
    met,
    pct: Math.round(sum / kpis.length),
    allMet: met === kpis.length,
    unmeasured,
  };
}

/** "4 weeks" / "80%" / "12" — a KPI value as the meter labels it. */
export function formatKpiValue(value: number | null, unit: string | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const rounded = Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
  if (!unit) return rounded;
  return unit === '%' || unit === '$'
    ? unit === '$'
      ? `$${rounded}`
      : `${rounded}%`
    : `${rounded} ${unit}`;
}
