// Hours report (the sheet's "Total Hours" tab): per-person hours by
// Monday–Sunday week over a picked range, with the % founders metric and a
// CSV export for payroll. Manage side sees everyone; employees see only
// their own column (no team totals or founder share). Amounts due (hours ×
// pay rate) show wherever the viewer knows the rate — the server only ships
// each person's own rate unless the viewer is an admin. A toggle regroups
// the weekly rows into the bi-weekly pay periods payroll actually pays.

import {
  addDays,
  amountsDue,
  founderIdsOf,
  groupIntoPayPeriods,
  payRatesOf,
  rollupHours,
  weekStartOf,
} from '@pyre/schedule-core';
import { useMemo, useState } from 'react';
import { useCachedJson } from '@/lib/client/cachedJson';
import type { ShiftAssignmentRow, ShiftRow, StaffRow, TimeOffRow } from '@/lib/db';

interface BoardData {
  staff: StaffRow[];
  shifts: Array<ShiftRow & { assignments: ShiftAssignmentRow[] }>;
  timeOff: TimeOffRow[];
  /** Manage side (schedule:manage / admin) — false = own hours only. */
  canManage?: boolean;
  /** Admins additionally see the labor-cost column. */
  isAdmin?: boolean;
  selfStaffId?: string | null;
}

const fmtCost = (cost: number): string => `$${Number.isInteger(cost) ? cost : cost.toFixed(2)}`;

const inputClass =
  'px-3 py-2 rounded bg-white/5 border border-white/10 text-sm text-[var(--pyre-creme)] focus:outline-none focus:border-white/30';

const buttonClass =
  'px-3 py-1.5 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

const todayLocal = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
};

const fmt = (hours: number): string => (Number.isInteger(hours) ? String(hours) : hours.toFixed(1));

export function ScheduleHours() {
  // Default: four weeks back through two weeks ahead.
  const [start, setStart] = useState(() => addDays(weekStartOf(todayLocal()), -28));
  const [end, setEnd] = useState(() => addDays(weekStartOf(todayLocal()), 20));
  const [byPeriod, setByPeriod] = useState(false);

  // Shares the schedule-board cache entry with ScheduleCalendar whenever the
  // ranges line up, so moving between the schedule tabs often costs nothing.
  const { data, error, loading, refreshing } = useCachedJson<BoardData>(
    `/api/admin/schedule-board?start=${start}&end=${end}`
  );
  // `busy` keeps the old `loading` semantics at the call sites below: true
  // for the first load and for every revalidation.
  const busy = loading || refreshing;

  const canManage = data?.canManage ?? false;
  const isAdmin = data?.isAdmin ?? false;
  const selfId = data?.selfStaffId ?? null;

  const { staffColumns, weeks } = useMemo(() => {
    if (!data) return { staffColumns: [] as StaffRow[], weeks: [] };
    const assignments = data.shifts
      .filter((s) => s.status === 'active')
      .flatMap((shift) =>
        shift.assignments.map((assignment) => ({ assignment, shiftDate: shift.shift_date }))
      );
    const rolled = rollupHours(assignments, founderIdsOf(data.staff));
    // Managers see everyone with hours in range (roster order); employees see
    // only themselves.
    const visible = canManage ? data.staff : data.staff.filter((s) => s.id === selfId);
    const withHours = new Set(rolled.flatMap((w) => Object.keys(w.byStaff)));
    return {
      staffColumns: visible.filter((s) => withHours.has(s.id)),
      weeks: rolled,
    };
  }, [data, canManage, selfId]);

  const totals = useMemo(() => {
    const byStaff: Record<string, number> = {};
    let total = 0;
    for (const week of weeks) {
      for (const [id, hours] of Object.entries(week.byStaff)) {
        byStaff[id] = (byStaff[id] ?? 0) + hours;
        total += hours;
      }
    }
    return { byStaff, total };
  }, [weeks]);

  // Rates the server let this viewer see: everyone's for admins, only their
  // own row otherwise (other rows arrive with pay_rate redacted to null).
  const rates = useMemo(() => payRatesOf(data?.staff ?? []), [data]);

  // One row list the table renders either way: the raw Monday weeks, or the
  // bi-weekly pay periods payroll pays (arrears — a period's payday is the
  // Monday after it ends). Range-clipped periods are flagged so a short
  // date range can't be misread as a full paycheck.
  const rows = useMemo(() => {
    if (!byPeriod) {
      return weeks.map((week) => ({
        key: week.weekStart,
        label: week.weekStart,
        sub: null as string | null,
        partial: false,
        byStaff: week.byStaff,
        total: week.total,
        founderShare: week.founderShare,
      }));
    }
    return groupIntoPayPeriods(weeks).map((p) => ({
      key: p.periodStart,
      label: `${p.periodStart} – ${p.periodEnd}`,
      sub: `paid ${p.payday}`,
      partial: p.weekCount < 2 || p.periodStart < weekStartOf(start) || p.periodEnd > end,
      byStaff: p.byStaff,
      total: p.total,
      founderShare: p.founderShare,
    }));
  }, [weeks, byPeriod, start, end]);

  // Amount due per row and for the range total: hours × rate, only for
  // people whose rate this viewer holds — so an admin's row total is true
  // labor cost, while everyone else can at most price their own column.
  const rowAmounts = useMemo(
    () => Object.fromEntries(rows.map((row) => [row.key, amountsDue(row.byStaff, rates)])),
    [rows, rates]
  );
  const totalAmounts = useMemo(() => amountsDue(totals.byStaff, rates), [totals, rates]);
  const hasPartial = rows.some((row) => row.partial);

  const exportCsv = () => {
    // Team totals and founder share are payroll aggregates — manage side
    // only; the labor-cost column is admin only. "$ due" columns only exist
    // for people whose rate the server shipped to this viewer. Cells join
    // with bare commas, so labels and dollar values must stay comma-free.
    const paid = (s: StaffRow) => rates[s.id] !== undefined;
    const rowLabel = (row: (typeof rows)[number]) =>
      `${row.label}${row.sub ? ` ${row.sub}` : ''}${row.partial ? ' (partial)' : ''}`;
    const header = [
      byPeriod ? 'Pay period' : 'Week of',
      ...staffColumns.flatMap((s) =>
        paid(s) ? [s.display_name, `${s.display_name} due`] : [s.display_name]
      ),
      ...(canManage ? ['Total', ...(isAdmin ? ['Cost'] : []), '% Founders'] : []),
    ];
    const csvRows = rows.map((row) => [
      rowLabel(row),
      ...staffColumns.flatMap((s) => {
        const hours = fmt(row.byStaff[s.id] ?? 0);
        return paid(s) ? [hours, fmtCost(rowAmounts[row.key]?.byStaff[s.id] ?? 0)] : [hours];
      }),
      ...(canManage
        ? [
            fmt(row.total),
            ...(isAdmin ? [fmtCost(rowAmounts[row.key]?.total ?? 0)] : []),
            row.founderShare == null ? '' : `${(row.founderShare * 100).toFixed(1)}%`,
          ]
        : []),
    ]);
    csvRows.push([
      'Total',
      ...staffColumns.flatMap((s) => {
        const hours = fmt(totals.byStaff[s.id] ?? 0);
        return paid(s) ? [hours, fmtCost(totalAmounts.byStaff[s.id] ?? 0)] : [hours];
      }),
      ...(canManage
        ? [fmt(totals.total), ...(isAdmin ? [fmtCost(totalAmounts.total)] : []), '']
        : []),
    ]);
    const csv = [header, ...csvRows].map((r) => r.join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `pyre-hours-${start}-to-${end}${byPeriod ? '-by-period' : ''}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="date"
          className={inputClass}
          value={start}
          onChange={(e) => e.target.value && setStart(e.target.value)}
          aria-label="From"
        />
        <span className="font-mono text-xs text-white/40">to</span>
        <input
          type="date"
          className={inputClass}
          value={end}
          onChange={(e) => e.target.value && setEnd(e.target.value)}
          aria-label="To"
        />
        <button
          type="button"
          className={`${buttonClass} ${byPeriod ? 'border-white/40 text-white' : ''}`}
          aria-pressed={byPeriod}
          onClick={() => setByPeriod((v) => !v)}
          title="Collapse weeks into the bi-weekly pay periods (paid the Monday after each period ends)"
        >
          Group by pay period
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={exportCsv}
          disabled={weeks.length === 0}
        >
          Export CSV
        </button>
        {busy && <span className="font-mono text-xs text-white/40">Loading…</span>}
      </div>

      {error && (
        <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-red)]">
          {error}
        </p>
      )}

      {!canManage && !selfId && !busy && (
        <p className="rounded border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-gold)]">
          Your login isn't linked to a roster entry yet, so there are no hours to show — ask an
          admin to set your Momence email on the roster.
        </p>
      )}

      {(weeks.length === 0 || staffColumns.length === 0) && !busy ? (
        <p className="font-mono text-sm text-white/40">No scheduled hours in this range.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left font-mono text-xs uppercase tracking-wide text-white/40">
                <th className="py-2 pr-3">{byPeriod ? 'Pay period' : 'Week of'}</th>
                {staffColumns.map((s) => (
                  <th key={s.id} className="py-2 pr-3 text-right">
                    {s.display_name}
                    {s.is_founder && <span title="Founder"> ✦</span>}
                  </th>
                ))}
                {canManage && (
                  <>
                    <th className="py-2 pr-3 text-right">Total</th>
                    {isAdmin && (
                      <th
                        className="py-2 pr-3 text-right"
                        title="Sum of each person's hours × their hourly rate"
                      >
                        Cost
                      </th>
                    )}
                    <th className="py-2 text-right">% Founders</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-white/5">
                  <td className="py-2 pr-3 font-mono text-white/70">
                    {row.label}
                    {row.partial && (
                      <span title="The picked range doesn't cover this whole pay period"> *</span>
                    )}
                    {row.sub && <div className="text-xs text-white/40">{row.sub}</div>}
                  </td>
                  {staffColumns.map((s) => {
                    const hours = row.byStaff[s.id] ?? 0;
                    const amount = rowAmounts[row.key]?.byStaff[s.id];
                    return (
                      <td
                        key={s.id}
                        className={`py-2 pr-3 text-right font-mono ${hours === 0 ? 'text-white/25' : ''}`}
                      >
                        {fmt(hours)}
                        {amount !== undefined && hours > 0 && (
                          <div className="text-xs text-white/40">{fmtCost(amount)}</div>
                        )}
                      </td>
                    );
                  })}
                  {canManage && (
                    <>
                      <td className="py-2 pr-3 text-right font-mono font-bold">{fmt(row.total)}</td>
                      {isAdmin && (
                        <td className="py-2 pr-3 text-right font-mono text-white/60">
                          {fmtCost(rowAmounts[row.key]?.total ?? 0)}
                        </td>
                      )}
                      <td className="py-2 text-right font-mono text-white/60">
                        {row.founderShare == null ? '—' : `${(row.founderShare * 100).toFixed(0)}%`}
                      </td>
                    </>
                  )}
                </tr>
              ))}
              <tr>
                <td className="py-2 pr-3 font-mono font-bold text-white/70">Total</td>
                {staffColumns.map((s) => {
                  const amount = totalAmounts.byStaff[s.id];
                  return (
                    <td key={s.id} className="py-2 pr-3 text-right font-mono font-bold">
                      {fmt(totals.byStaff[s.id] ?? 0)}
                      {amount !== undefined && (
                        <div className="text-xs font-normal text-white/40">{fmtCost(amount)}</div>
                      )}
                    </td>
                  );
                })}
                {canManage && (
                  <>
                    <td className="py-2 pr-3 text-right font-mono font-bold">
                      {fmt(totals.total)}
                    </td>
                    {isAdmin && (
                      <td className="py-2 pr-3 text-right font-mono font-bold">
                        {fmtCost(totalAmounts.total)}
                      </td>
                    )}
                    <td />
                  </>
                )}
              </tr>
            </tbody>
          </table>
          {hasPartial && (
            <p className="mt-2 font-mono text-xs text-white/40">
              * the picked range doesn't cover this whole pay period — widen it before paying out.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
