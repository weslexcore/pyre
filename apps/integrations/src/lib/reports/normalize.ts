// Turns raw Momence report items into the weekly metric rows the business
// dashboard reads. Momence does not document per-type item shapes, so every
// extractor here is candidate-key based and failure-tolerant: an item that
// can't be parsed is counted (it drives the snapshot's normalize_status
// triage field) but never throws — one weird row must not sink a report.
//
// Weeks are Monday-start ET wall-clock, matching @pyre/schedule-core.
// Momence reports are assumed to return host-local (ET) dates; verify against
// the first real snapshot and adjust here if not.

import { weekStartOf } from '@pyre/schedule-core';
import type { MomenceReportType } from '@/lib/momence/reports';

export type MetricKey =
  | 'revenue_total'
  | 'new_members'
  | 'membership_cancellations'
  | 'active_members'
  | 'attendance'
  | 'no_shows'
  | 'occupancy_pct';

export interface MetricUpsert {
  weekStart: string;
  metric: MetricKey;
  value: number;
}

export interface NormalizeResult {
  metrics: MetricUpsert[];
  parsed: number;
  unparseable: number;
  status: 'ok' | 'empty' | 'parse-partial';
}

// --- Defensive field extraction ---

const DATE_KEYS = [
  'date',
  'saleDate',
  'sessionDate',
  'visitDate',
  'startsAt',
  'startDate',
  'cancelledAt',
  'createdAt',
  'day',
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

function asRecord(item: unknown): Record<string, unknown> | null {
  return typeof item === 'object' && item !== null && !Array.isArray(item)
    ? (item as Record<string, unknown>)
    : null;
}

/** First candidate key holding an ISO-ish date, as YYYY-MM-DD. */
function pickDate(rec: Record<string, unknown>): string | null {
  for (const key of DATE_KEYS) {
    const value = rec[key];
    if (typeof value === 'string' && DATE_RE.test(value)) return value.slice(0, 10);
  }
  return null;
}

/** First candidate key holding a finite number (numeric strings included). */
function pickNumber(rec: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

// --- Per-type extraction plans ---

interface FlowPlan {
  kind: 'flow';
  metric: MetricKey;
  valueKeys: string[];
  /** Row-per-event reports (attendance, no-shows): a dated item with no
   * numeric field still counts as 1 occurrence. */
  countFallback: boolean;
}

interface StockPlan {
  kind: 'stock';
  metric: MetricKey;
  valueKeys: string[];
}

interface RatioPlan {
  kind: 'ratio';
  metric: MetricKey;
  numeratorKeys: string[];
  denominatorKeys: string[];
}

type Plan = FlowPlan | StockPlan | RatioPlan;

// REVENUE_BREAKDOWN is snapshot-only for now (raw jsonb, no weekly metric):
// it slices the same dollars as TOTAL_SALES, so folding it into
// revenue_total would double-write the row with a differently-shaped source.
const PLANS: Partial<Record<MomenceReportType, Plan>> = {
  TOTAL_SALES: {
    kind: 'flow',
    metric: 'revenue_total',
    valueKeys: ['total', 'totalInCurrency', 'amount', 'amountInCurrency', 'revenue', 'totalPrice'],
    countFallback: false,
  },
  NEW_MEMBERS: {
    kind: 'flow',
    metric: 'new_members',
    valueKeys: ['newMembers', 'count', 'total'],
    countFallback: true,
  },
  MEMBERSHIP_CANCELLATIONS: {
    kind: 'flow',
    metric: 'membership_cancellations',
    valueKeys: ['cancellations', 'count', 'total'],
    countFallback: true,
  },
  ATTENDANCE: {
    kind: 'flow',
    metric: 'attendance',
    valueKeys: ['attendees', 'attendance', 'visits', 'checkedInCount', 'count'],
    countFallback: true,
  },
  NO_SHOWS: {
    kind: 'flow',
    metric: 'no_shows',
    valueKeys: ['noShows', 'count', 'total'],
    countFallback: true,
  },
  ACTIVE_MEMBERS: {
    kind: 'stock',
    metric: 'active_members',
    valueKeys: ['activeMembers', 'count', 'total', 'value'],
  },
  SESSION_OCCUPANCY: {
    kind: 'ratio',
    metric: 'occupancy_pct',
    numeratorKeys: ['attendees', 'booked', 'bookedCount', 'checkedInCount', 'attendance'],
    denominatorKeys: ['capacity', 'maxCapacity', 'spots', 'totalSpots'],
  },
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Normalize one report's items into weekly metric upserts.
 *
 * `snapshotDate` anchors stock reports that come back date-less (a single
 * point-in-time count lands on the snapshot's own week).
 */
export function normalizeReport(
  reportType: MomenceReportType,
  items: unknown[],
  snapshotDate: string
): NormalizeResult {
  const plan = PLANS[reportType];
  if (items.length === 0) return { metrics: [], parsed: 0, unparseable: 0, status: 'empty' };
  if (!plan) return { metrics: [], parsed: items.length, unparseable: 0, status: 'ok' };

  let parsed = 0;
  let unparseable = 0;

  const metrics: MetricUpsert[] = [];

  if (plan.kind === 'flow') {
    const weekly: Record<string, number> = {};
    for (const item of items) {
      const rec = asRecord(item);
      const date = rec ? pickDate(rec) : null;
      if (!rec || !date) {
        unparseable += 1;
        continue;
      }
      const value = pickNumber(rec, plan.valueKeys) ?? (plan.countFallback ? 1 : null);
      if (value === null) {
        unparseable += 1;
        continue;
      }
      const week = weekStartOf(date);
      weekly[week] = (weekly[week] ?? 0) + value;
      parsed += 1;
    }
    for (const [weekStart, value] of Object.entries(weekly)) {
      metrics.push({ weekStart, metric: plan.metric, value: round2(value) });
    }
  } else if (plan.kind === 'stock') {
    // Latest reading per week wins; a date-less count is a point-in-time
    // value anchored to the snapshot day.
    const latest: Record<string, { date: string; value: number }> = {};
    for (const item of items) {
      const rec = asRecord(item);
      const value = rec ? pickNumber(rec, plan.valueKeys) : null;
      if (!rec || value === null) {
        unparseable += 1;
        continue;
      }
      const date = pickDate(rec) ?? snapshotDate;
      const week = weekStartOf(date);
      const current = latest[week];
      if (!current || date >= current.date) latest[week] = { date, value };
      parsed += 1;
    }
    for (const [weekStart, entry] of Object.entries(latest)) {
      metrics.push({ weekStart, metric: plan.metric, value: round2(entry.value) });
    }
  } else {
    // Occupancy: attendees-sum / capacity-sum per week — averaging
    // per-session percentages would let empty tiny sessions swamp full
    // big ones.
    const sums: Record<string, { num: number; den: number }> = {};
    for (const item of items) {
      const rec = asRecord(item);
      const date = rec ? pickDate(rec) : null;
      const num = rec ? pickNumber(rec, plan.numeratorKeys) : null;
      const den = rec ? pickNumber(rec, plan.denominatorKeys) : null;
      if (!rec || !date || num === null || den === null) {
        unparseable += 1;
        continue;
      }
      const week = weekStartOf(date);
      sums[week] ??= { num: 0, den: 0 };
      sums[week].num += num;
      sums[week].den += den;
      parsed += 1;
    }
    for (const [weekStart, { num, den }] of Object.entries(sums)) {
      if (den > 0) {
        metrics.push({ weekStart, metric: plan.metric, value: round2((num / den) * 100) });
      }
    }
  }

  metrics.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  return {
    metrics,
    parsed,
    unparseable,
    status: unparseable > 0 ? 'parse-partial' : 'ok',
  };
}
