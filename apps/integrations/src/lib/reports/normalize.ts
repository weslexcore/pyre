// Turns raw Momence report items into the weekly metric rows the business
// dashboard reads.
//
// Only one report type exists (TOTAL_SALES — see MomenceReportType), and its
// item shape is undocumented but observed: one row per payment transaction,
// with the fields named in TotalSalesItem below. Extraction stays candidate-
// key based and failure-tolerant anyway — Momence can add or rename a field
// without telling anyone, and one weird row must not sink a report. An item
// that can't be parsed is counted (it drives the snapshot's normalize_status
// triage field) but never throws.
//
// Weeks are Monday-start ET wall-clock, matching @pyre/schedule-core.
// paymentDate is a UTC *instant* (…T22:35:15.877Z), not a host-local date, so
// it is converted to the ET calendar day before bucketing. Slicing the raw
// string instead would push every sale after 8pm ET into the next day — and
// across a Sunday/Monday boundary, into the wrong week.

import { utcToEastern, weekStartOf } from '@pyre/schedule-core';
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

/**
 * One row of a `total-sales` report, as the API actually returns it. Every
 * field is optional here because nothing about the shape is contractual.
 *
 *   paymentDate   UTC instant the money moved
 *   paymentValue  gross charged, in host currency
 *   refunded      amount refunded off this transaction (0 when none) —
 *                 refunds are folded back into the original row rather than
 *                 appearing as separate negative rows
 *   paymentStatus 'succeeded' on every row observed; anything else is not
 *                 collected revenue and is excluded from the total
 */
interface TotalSalesItem {
  paymentDate?: unknown;
  serviceDate?: unknown;
  paymentValue?: unknown;
  refunded?: unknown;
  paymentStatus?: unknown;
}

// --- Defensive field extraction ---

/** paymentDate is the money-movement date; serviceDate is a fallback for
 * hypothetical rows that omit it (none observed). */
const DATE_KEYS = ['paymentDate', 'serviceDate'];
const VALUE_KEYS = ['paymentValue'];
const REFUND_KEYS = ['refunded'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

function asRecord(item: unknown): Record<string, unknown> | null {
  return typeof item === 'object' && item !== null && !Array.isArray(item)
    ? (item as Record<string, unknown>)
    : null;
}

/**
 * First candidate key holding an ISO-ish date, as the ET calendar day.
 * Timestamps carrying a zone/offset are converted; a bare YYYY-MM-DD is
 * already a wall-clock date and is taken as-is.
 */
function pickEasternDate(rec: Record<string, unknown>): string | null {
  for (const key of DATE_KEYS) {
    const value = rec[key];
    if (typeof value !== 'string' || !DATE_RE.test(value)) continue;
    if (value.length <= 10) return value.slice(0, 10);
    const parsed = utcToEastern(value);
    if (parsed.date) return parsed.date;
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

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Net revenue for one sale row: gross minus whatever was refunded off it.
 * Returns null for a row that isn't collected revenue at all (unparseable
 * amount, or a payment that never succeeded).
 */
function netRevenue(item: TotalSalesItem, rec: Record<string, unknown>): number | null {
  const status = item.paymentStatus;
  if (typeof status === 'string' && status !== 'succeeded') return null;

  const gross = pickNumber(rec, VALUE_KEYS);
  if (gross === null) return null;

  const refunded = pickNumber(rec, REFUND_KEYS) ?? 0;
  return gross - refunded;
}

/**
 * Normalize one report's items into weekly metric upserts.
 *
 * `snapshotDate` is unused for the flow-shaped TOTAL_SALES report but is kept
 * in the signature: it anchors any future point-in-time (stock) metric whose
 * items come back date-less.
 */
export function normalizeReport(
  reportType: MomenceReportType,
  items: unknown[],
  _snapshotDate: string
): NormalizeResult {
  if (items.length === 0) return { metrics: [], parsed: 0, unparseable: 0, status: 'empty' };
  // Exhaustive today (TOTAL_SALES is the only type); a future type without an
  // extractor is snapshot-only rather than an error.
  if (reportType !== 'TOTAL_SALES') {
    return { metrics: [], parsed: items.length, unparseable: 0, status: 'ok' };
  }

  let parsed = 0;
  let unparseable = 0;
  const weekly: Record<string, number> = {};

  for (const item of items) {
    const rec = asRecord(item);
    const date = rec ? pickEasternDate(rec) : null;
    if (!rec || !date) {
      unparseable += 1;
      continue;
    }

    const value = netRevenue(rec as TotalSalesItem, rec);
    if (value === null) {
      // A non-succeeded payment is understood, not malformed — it simply
      // isn't revenue, so it must not flag the snapshot parse-partial.
      const status = (rec as TotalSalesItem).paymentStatus;
      if (typeof status === 'string' && status !== 'succeeded') parsed += 1;
      else unparseable += 1;
      continue;
    }

    const week = weekStartOf(date);
    weekly[week] = (weekly[week] ?? 0) + value;
    parsed += 1;
  }

  const metrics: MetricUpsert[] = Object.entries(weekly)
    .map(([weekStart, value]) => ({
      weekStart,
      metric: 'revenue_total' as const,
      value: round2(value),
    }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  return {
    metrics,
    parsed,
    unparseable,
    status: unparseable > 0 ? 'parse-partial' : 'ok',
  };
}
