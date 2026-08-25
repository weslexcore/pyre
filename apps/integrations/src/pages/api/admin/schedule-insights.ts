// Read side of /admin/schedule/insights — one admin-only GET over a fixed
// window (last 8 completed weeks through the end of the NEXT pay period)
// returning weekly cost trends, pay-period costs with a forecast, per-person
// consistency stats against their own weekly target, and unmet-demand stats.
//
// Separate from schedule-board on purpose: that route only ever ships
// pending/open requests, while this one aggregates the full paper trail
// (denied shift_requests, claimed sub_requests) — and it is admin-only, so
// staff rows here carry unredacted pay rates and targets that must never be
// echoed back beyond the aggregates below.

import {
  addDays,
  amountsDue,
  applyStipends,
  type ConsistencyRow,
  completedWeekStarts,
  consistencyStats,
  founderIdsOf,
  groupIntoPayPeriods,
  openHoursByWeek,
  payPeriodStartOf,
  payRatesOf,
  rollupHours,
  utcToEastern,
  weekStartOf,
} from '@pyre/schedule-core';
import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/auth/admin';
import {
  getDb,
  type ShiftAssignmentRow,
  type ShiftRequestRow,
  type ShiftRow,
  type StaffRow,
  type StaffStipendRow,
  type StipendOverrideRow,
  type SubRequestRow,
} from '@/lib/db';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** Default history window; overridable via ?weeks= within [MIN, MAX]. */
const HISTORY_WEEKS = 8;
const MIN_HISTORY_WEEKS = 1;
const MAX_HISTORY_WEEKS = 52;

export interface InsightsWeek {
  weekStart: string;
  total: number;
  founderShare: number | null;
  /** Labor cost: Σ hours × each person's rate (admin holds every rate). */
  cost: number;
  paidHours: number;
  founderHours: number;
  /**
   * Customer-facing (revenue-generating) hours: shift windows minus their
   * staff-only setup/shutdown padding. Not × staff_needed.
   */
  openHours: number;
  /** Labor cost ÷ openHours — the revenue/hour needed to break even on labor. */
  costPerOpenHour: number | null;
  /** Week hasn't finished yet — partial numbers. */
  future: boolean;
}

export interface InsightsPeriod {
  periodStart: string;
  periodEnd: string;
  payday: string;
  total: number;
  cost: number;
  founderShare: number | null;
  weekCount: number;
  status: 'past' | 'current' | 'next';
}

export interface InsightsDemandRow {
  staffId: string;
  name: string;
  pending: number;
  denied: number;
  approved: number;
  deniedRecent: Array<{ shiftDate: string; label: string; decidedAt: string | null }>;
  /** Sub requests they made that someone claimed (shifts given away). */
  subsGivenAway: number;
  /** Sub requests they made still waiting for a claimer. */
  subsOpen: number;
  /** Sub requests they claimed from someone else. */
  subsClaimed: number;
}

export interface ScheduleInsightsPayload {
  today: string;
  range: { start: string; end: string };
  /** Latest shift date actually present — the forecast is partial past this. */
  scheduledThrough: string;
  /** Mondays of the completed-weeks history window the consistency stats cover. */
  historyWeekStarts: string[];
  staff: Array<{
    id: string;
    name: string;
    isFounder: boolean;
    active: boolean;
    payRate: number;
    targetHours: number | null;
  }>;
  weeks: InsightsWeek[];
  periods: InsightsPeriod[];
  consistency: Array<ConsistencyRow & { name: string }>;
  /** Since requests launched (mid-Aug 2026), not the full history window. */
  demand: InsightsDemandRow[];
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const today = utcToEastern(new Date().toISOString()).date;
  const thisWeek = weekStartOf(today);
  const currentPeriodStart = payPeriodStartOf(today);

  // Two window modes: ?weeks=N (last N completed weeks, plus the current and
  // next pay period ahead) or ?start=&end= (an explicit custom range, snapped
  // to Monday weeks). Either way the fetch below is widened to always cover
  // the current + next pay period so the forecast tiles work regardless of
  // the window the charts show.
  const startParam = url.searchParams.get('start');
  const endParam = url.searchParams.get('end');
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  let displayWeekStarts: string[];
  if (startParam !== null || endParam !== null) {
    if (
      !startParam ||
      !DATE_RE.test(startParam) ||
      !endParam ||
      !DATE_RE.test(endParam) ||
      endParam < startParam
    ) {
      return json({ error: 'start and end must be YYYY-MM-DD with end >= start' }, 400);
    }
    const firstWeek = weekStartOf(startParam);
    const lastWeek = weekStartOf(endParam);
    displayWeekStarts = [];
    for (let ws = firstWeek; ws <= lastWeek; ws = addDays(ws, 7)) {
      displayWeekStarts.push(ws);
      if (displayWeekStarts.length > MAX_HISTORY_WEEKS * 2) {
        return json({ error: `Custom range is capped at ${MAX_HISTORY_WEEKS * 2} weeks` }, 400);
      }
    }
  } else {
    const weeksParam = url.searchParams.get('weeks');
    const parsedWeeks = weeksParam === null ? HISTORY_WEEKS : Number(weeksParam);
    if (
      !Number.isInteger(parsedWeeks) ||
      parsedWeeks < MIN_HISTORY_WEEKS ||
      parsedWeeks > MAX_HISTORY_WEEKS
    ) {
      return json(
        { error: `weeks must be an integer between ${MIN_HISTORY_WEEKS} and ${MAX_HISTORY_WEEKS}` },
        400
      );
    }
    // History plus the in-progress weeks through the end of the next period.
    displayWeekStarts = completedWeekStarts(today, parsedWeeks);
    for (let ws = thisWeek; ws <= addDays(currentPeriodStart, 21); ws = addDays(ws, 7)) {
      displayWeekStarts.push(ws);
    }
  }

  // Completed display weeks drive the consistency stats.
  const weekStarts = displayWeekStarts.filter((ws) => ws < thisWeek);
  const displayStart = displayWeekStarts[0];
  const displayEnd = addDays(displayWeekStarts[displayWeekStarts.length - 1], 6);

  const rangeStart = displayStart < currentPeriodStart ? displayStart : currentPeriodStart;
  const forecastEnd = addDays(currentPeriodStart, 27);
  const rangeEnd = displayEnd > forecastEnd ? displayEnd : forecastEnd;

  const [staffRes, shiftsRes, stipendsRes, stipendOverridesRes] = await Promise.all([
    db.from('staff').select('*').order('display_name'),
    db
      .from('shifts')
      .select('*')
      .gte('shift_date', rangeStart)
      .lte('shift_date', rangeEnd)
      .eq('is_draft', false)
      .order('shift_date'),
    db.from('staff_stipends').select('*'),
    db.from('stipend_overrides').select('*'),
  ]);
  const queryError =
    staffRes.error ?? shiftsRes.error ?? stipendsRes.error ?? stipendOverridesRes.error;
  if (queryError) return json({ error: queryError.message }, 500);

  const staff = (staffRes.data ?? []) as StaffRow[];
  const stipends = (stipendsRes.data ?? []) as StaffStipendRow[];
  const stipendOverrides = (stipendOverridesRes.data ?? []) as StipendOverrideRow[];
  const shifts = (shiftsRes.data ?? []) as ShiftRow[];
  const shiftIds = shifts.map((s) => s.id);
  const shiftById = new Map(shifts.map((s) => [s.id, s]));

  let assignments: ShiftAssignmentRow[] = [];
  let shiftRequests: ShiftRequestRow[] = [];
  let subRequests: SubRequestRow[] = [];
  if (shiftIds.length > 0) {
    const [assignmentsRes, requestsRes, subsRes] = await Promise.all([
      db.from('shift_assignments').select('*').in('shift_id', shiftIds).eq('is_draft', false),
      // ALL statuses — denied rows are the "asked and didn't get it" signal.
      db.from('shift_requests').select('*').in('shift_id', shiftIds).order('created_at'),
      db.from('sub_requests').select('*').in('shift_id', shiftIds),
    ]);
    const subError = assignmentsRes.error ?? requestsRes.error ?? subsRes.error;
    if (subError) return json({ error: subError.message }, 500);
    assignments = (assignmentsRes.data ?? []) as ShiftAssignmentRow[];
    shiftRequests = (requestsRes.data ?? []) as ShiftRequestRow[];
    subRequests = (subsRes.data ?? []) as SubRequestRow[];
  }

  // ---- Hours & cost ----
  const activeShiftIds = new Set(shifts.filter((s) => s.status === 'active').map((s) => s.id));
  const rolled = rollupHours(
    assignments
      .filter((a) => activeShiftIds.has(a.shift_id))
      .map((assignment) => ({
        assignment,
        shiftDate: shiftById.get(assignment.shift_id)?.shift_date ?? '',
      }))
      .filter((r) => r.shiftDate !== ''),
    founderIdsOf(staff)
  );
  // Stipend hours ride into the cost math (weeks + period tiles) so labor
  // cost matches the hours report. Consistency stats below stay on `rolled`:
  // target_hours_per_week is a scheduled-shifts target.
  const withStipends = applyStipends(
    rolled,
    stipends,
    stipendOverrides,
    founderIdsOf(staff),
    rangeStart,
    rangeEnd
  );
  const rates = payRatesOf(staff);
  const openHours = openHoursByWeek(shifts);

  // Chart weeks stay inside the selected window; the wider fetch exists only
  // for the always-on forecast tiles (periods below).
  const displaySet = new Set(displayWeekStarts);
  const weeks: InsightsWeek[] = withStipends
    .filter((week) => displaySet.has(week.weekStart))
    .map((week) => {
      const cost = amountsDue(week.byStaff, rates).total;
      const founderHours = (week.founderShare ?? 0) * week.total;
      const open = openHours[week.weekStart] ?? 0;
      return {
        weekStart: week.weekStart,
        total: week.total,
        founderShare: week.founderShare,
        cost,
        paidHours: Math.round((week.total - founderHours) * 10) / 10,
        founderHours: Math.round(founderHours * 10) / 10,
        openHours: Math.round(open * 10) / 10,
        costPerOpenHour: open > 0 ? Math.round((cost / open) * 100) / 100 : null,
        future: week.weekStart >= thisWeek,
      };
    });

  const periods: InsightsPeriod[] = groupIntoPayPeriods(withStipends).map((p) => ({
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    payday: p.payday,
    total: p.total,
    cost: amountsDue(p.byStaff, rates).total,
    founderShare: p.founderShare,
    weekCount: p.weekCount,
    status:
      p.periodStart < currentPeriodStart
        ? 'past'
        : p.periodStart === currentPeriodStart
          ? 'current'
          : 'next',
  }));

  // ---- Consistency (history window only; show active people or anyone with hours) ----
  const historySet = new Set(weekStarts);
  const historyWeeks = rolled.filter((w) => historySet.has(w.weekStart));
  const hadHours = new Set(historyWeeks.flatMap((w) => Object.keys(w.byStaff)));
  const consistencyStaff = staff.filter((s) => s.active || hadHours.has(s.id));
  const nameById = new Map(staff.map((s) => [s.id, s.display_name]));
  const consistency = consistencyStats(historyWeeks, weekStarts, consistencyStaff).map((row) => ({
    ...row,
    name: nameById.get(row.staffId) ?? row.staffId,
  }));

  // ---- Demand ----
  const demandById = new Map<string, InsightsDemandRow>();
  const demandRow = (staffId: string): InsightsDemandRow => {
    let row = demandById.get(staffId);
    if (!row) {
      row = {
        staffId,
        name: nameById.get(staffId) ?? staffId,
        pending: 0,
        denied: 0,
        approved: 0,
        deniedRecent: [],
        subsGivenAway: 0,
        subsOpen: 0,
        subsClaimed: 0,
      };
      demandById.set(staffId, row);
    }
    return row;
  };

  // Demand honors the selected window too — the wider fetch is forecast-only.
  const inDisplay = (shiftId: string): boolean => {
    const date = shiftById.get(shiftId)?.shift_date;
    return date !== undefined && date >= displayStart && date <= displayEnd;
  };
  for (const req of shiftRequests) {
    if (!inDisplay(req.shift_id)) continue;
    const row = demandRow(req.staff_id);
    if (req.status === 'pending') row.pending += 1;
    else if (req.status === 'approved') row.approved += 1;
    else {
      row.denied += 1;
      const shift = shiftById.get(req.shift_id);
      row.deniedRecent.push({
        shiftDate: shift?.shift_date ?? '',
        label: shift?.label ?? '',
        decidedAt: req.decided_at,
      });
    }
  }
  for (const row of demandById.values()) {
    row.deniedRecent = row.deniedRecent
      .sort((a, b) => b.shiftDate.localeCompare(a.shiftDate))
      .slice(0, 5);
  }
  for (const sub of subRequests) {
    if (!inDisplay(sub.shift_id)) continue;
    if (sub.status === 'claimed') {
      demandRow(sub.requester_staff_id).subsGivenAway += 1;
      if (sub.claimed_by_staff_id) demandRow(sub.claimed_by_staff_id).subsClaimed += 1;
    } else if (sub.status === 'open') {
      demandRow(sub.requester_staff_id).subsOpen += 1;
    }
  }

  const payload: ScheduleInsightsPayload = {
    today,
    range: { start: displayStart, end: displayEnd },
    scheduledThrough: shifts.length > 0 ? shifts[shifts.length - 1].shift_date : today,
    historyWeekStarts: weekStarts,
    staff: staff.map((s) => ({
      id: s.id,
      name: s.display_name,
      isFounder: s.is_founder,
      active: s.active,
      payRate: s.pay_rate ?? 0,
      targetHours: s.target_hours_per_week,
    })),
    weeks,
    periods,
    consistency,
    demand: [...demandById.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };

  return json(payload);
};
