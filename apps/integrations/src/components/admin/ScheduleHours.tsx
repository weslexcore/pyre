// Hours report (the sheet's "Total Hours" tab): per-person hours by
// Monday–Sunday week over a picked range, with the % founders metric and a
// CSV export for payroll. Manage side sees everyone; employees see only
// their own column (no team totals or founder share).

import { addDays, founderIdsOf, rollupHours, weekStartOf } from '@pyre/schedule-core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ScheduleStaffRow, ShiftAssignmentRow, ShiftRow, TimeOffRow } from '@/lib/db';

interface BoardData {
  staff: ScheduleStaffRow[];
  shifts: Array<ShiftRow & { assignments: ShiftAssignmentRow[] }>;
  timeOff: TimeOffRow[];
  /** Manage side (schedule:manage / admin) — false = own hours only. */
  canManage?: boolean;
  selfStaffId?: string | null;
}

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
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/schedule-board?start=${start}&end=${end}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as BoardData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [start, end]);

  useEffect(() => {
    void load();
  }, [load]);

  const canManage = data?.canManage ?? false;
  const selfId = data?.selfStaffId ?? null;

  const { staffColumns, weeks } = useMemo(() => {
    if (!data) return { staffColumns: [] as ScheduleStaffRow[], weeks: [] };
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

  const exportCsv = () => {
    // Team totals and founder share are payroll aggregates — manage side only.
    const header = [
      'Week of',
      ...staffColumns.map((s) => s.display_name),
      ...(canManage ? ['Total', '% Founders'] : []),
    ];
    const rows = weeks.map((week) => [
      week.weekStart,
      ...staffColumns.map((s) => fmt(week.byStaff[s.id] ?? 0)),
      ...(canManage
        ? [
            fmt(week.total),
            week.founderShare == null ? '' : `${(week.founderShare * 100).toFixed(1)}%`,
          ]
        : []),
    ]);
    rows.push([
      'Total',
      ...staffColumns.map((s) => fmt(totals.byStaff[s.id] ?? 0)),
      ...(canManage ? [fmt(totals.total), ''] : []),
    ]);
    const csv = [header, ...rows].map((r) => r.join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `pyre-hours-${start}-to-${end}.csv`;
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
          className={buttonClass}
          onClick={exportCsv}
          disabled={weeks.length === 0}
        >
          Export CSV
        </button>
        {loading && <span className="font-mono text-xs text-white/40">Loading…</span>}
      </div>

      {error && (
        <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-red)]">
          {error}
        </p>
      )}

      {!canManage && !selfId && !loading && (
        <p className="rounded border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-gold)]">
          Your login isn't linked to a roster entry yet, so there are no hours to show — ask an
          admin to set your Momence email on the roster.
        </p>
      )}

      {(weeks.length === 0 || staffColumns.length === 0) && !loading ? (
        <p className="font-mono text-sm text-white/40">No scheduled hours in this range.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left font-mono text-xs uppercase tracking-wide text-white/40">
                <th className="py-2 pr-3">Week of</th>
                {staffColumns.map((s) => (
                  <th key={s.id} className="py-2 pr-3 text-right">
                    {s.display_name}
                    {s.is_founder && <span title="Founder"> ✦</span>}
                  </th>
                ))}
                {canManage && (
                  <>
                    <th className="py-2 pr-3 text-right">Total</th>
                    <th className="py-2 text-right">% Founders</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week.weekStart} className="border-b border-white/5">
                  <td className="py-2 pr-3 font-mono text-white/70">{week.weekStart}</td>
                  {staffColumns.map((s) => {
                    const hours = week.byStaff[s.id] ?? 0;
                    return (
                      <td
                        key={s.id}
                        className={`py-2 pr-3 text-right font-mono ${hours === 0 ? 'text-white/25' : ''}`}
                      >
                        {fmt(hours)}
                      </td>
                    );
                  })}
                  {canManage && (
                    <>
                      <td className="py-2 pr-3 text-right font-mono font-bold">
                        {fmt(week.total)}
                      </td>
                      <td className="py-2 text-right font-mono text-white/60">
                        {week.founderShare == null
                          ? '—'
                          : `${(week.founderShare * 100).toFixed(0)}%`}
                      </td>
                    </>
                  )}
                </tr>
              ))}
              <tr>
                <td className="py-2 pr-3 font-mono font-bold text-white/70">Total</td>
                {staffColumns.map((s) => (
                  <td key={s.id} className="py-2 pr-3 text-right font-mono font-bold">
                    {fmt(totals.byStaff[s.id] ?? 0)}
                  </td>
                ))}
                {canManage && (
                  <>
                    <td className="py-2 pr-3 text-right font-mono font-bold">
                      {fmt(totals.total)}
                    </td>
                    <td />
                  </>
                )}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
