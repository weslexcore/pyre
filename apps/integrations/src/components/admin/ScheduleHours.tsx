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
  applyStipends,
  founderIdsOf,
  groupIntoPayPeriods,
  payRatesOf,
  rollupHours,
  weekStartOf,
} from '@pyre/schedule-core';
import { useMemo, useState } from 'react';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import type {
  ShiftAssignmentRow,
  ShiftRow,
  StaffRow,
  StaffStipendRow,
  StipendOverrideRow,
  TimeOffRow,
} from '@/lib/db';

interface BoardData {
  staff: StaffRow[];
  shifts: Array<ShiftRow & { assignments: ShiftAssignmentRow[] }>;
  timeOff: TimeOffRow[];
  /** All stipends on the manage side; only the viewer's own otherwise. */
  stipends?: StaffStipendRow[];
  stipendOverrides?: StipendOverrideRow[];
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
  const { data, error, loading, refreshing, reload } = useCachedJson<BoardData>(
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
    // Stipend hours (recurring weekly, with per-week overrides) fold into the
    // same rollup, so amounts due and pay periods price them automatically.
    const rolled = applyStipends(
      rollupHours(assignments, founderIdsOf(data.staff)),
      data.stipends ?? [],
      data.stipendOverrides ?? [],
      founderIdsOf(data.staff),
      start,
      end
    );
    // Managers see everyone with hours in range (roster order); employees see
    // only themselves.
    const visible = canManage ? data.staff : data.staff.filter((s) => s.id === selfId);
    const withHours = new Set(rolled.flatMap((w) => Object.keys(w.byStaff)));
    return {
      staffColumns: visible.filter((s) => withHours.has(s.id)),
      weeks: rolled,
    };
  }, [data, canManage, selfId, start, end]);

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
        stipendByStaff: week.stipendByStaff,
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
      stipendByStaff: p.stipendByStaff,
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

  const labelColClass = canManage ? 'sticky left-0 z-10 bg-[var(--pyre-black)]' : '';

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

      {/* Managers get a table wide enough to scroll; pin the label column so rows stay readable. */}
      {(weeks.length === 0 || staffColumns.length === 0) && !busy ? (
        <p className="font-mono text-sm text-white/40">No scheduled hours in this range.</p>
      ) : (
        <div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left font-mono text-xs uppercase tracking-wide text-white/40">
                  <th className={`whitespace-nowrap py-2 pr-3 ${labelColClass}`}>
                    {byPeriod ? 'Pay period' : 'Week of'}
                  </th>
                  {staffColumns.map((s) => (
                    <th key={s.id} className="whitespace-nowrap py-2 pr-3 text-right">
                      {s.display_name}
                      {s.is_founder && <span title="Founder"> ✦</span>}
                    </th>
                  ))}
                  {canManage && (
                    <>
                      <th className="whitespace-nowrap py-2 pr-3 text-right">Total</th>
                      {isAdmin && (
                        <th
                          className="whitespace-nowrap py-2 pr-3 text-right"
                          title="Sum of each person's hours × their hourly rate"
                        >
                          Cost
                        </th>
                      )}
                      <th className="whitespace-nowrap py-2 text-right">% Founders</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-b border-white/5">
                    <td
                      className={`whitespace-nowrap py-2 pr-3 font-mono text-white/70 ${labelColClass}`}
                    >
                      {row.label}
                      {row.partial && (
                        <span title="The picked range doesn't cover this whole pay period"> *</span>
                      )}
                      {row.sub && <div className="text-xs text-white/40">{row.sub}</div>}
                    </td>
                    {staffColumns.map((s) => {
                      const hours = row.byStaff[s.id] ?? 0;
                      const amount = rowAmounts[row.key]?.byStaff[s.id];
                      const stipend = row.stipendByStaff?.[s.id] ?? 0;
                      return (
                        <td
                          key={s.id}
                          className={`whitespace-nowrap py-2 pr-3 text-right font-mono ${hours === 0 ? 'text-white/25' : ''}`}
                        >
                          {fmt(hours)}
                          {stipend > 0 && (
                            <div
                              className="text-xs text-[var(--pyre-gold)]/70"
                              title="Stipend hours included in this cell (recurring weekly, adjustable per week below)"
                            >
                              incl. {fmt(stipend)} stipend
                            </div>
                          )}
                          {amount !== undefined && hours > 0 && (
                            <div className="text-xs text-white/40">{fmtCost(amount)}</div>
                          )}
                        </td>
                      );
                    })}
                    {canManage && (
                      <>
                        <td className="whitespace-nowrap py-2 pr-3 text-right font-mono font-bold">
                          {fmt(row.total)}
                        </td>
                        {isAdmin && (
                          <td className="whitespace-nowrap py-2 pr-3 text-right font-mono text-white/60">
                            {fmtCost(rowAmounts[row.key]?.total ?? 0)}
                          </td>
                        )}
                        <td className="whitespace-nowrap py-2 text-right font-mono text-white/60">
                          {row.founderShare == null
                            ? '—'
                            : `${(row.founderShare * 100).toFixed(0)}%`}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
                <tr>
                  <td
                    className={`whitespace-nowrap py-2 pr-3 font-mono font-bold text-white/70 ${labelColClass}`}
                  >
                    Total
                  </td>
                  {staffColumns.map((s) => {
                    const amount = totalAmounts.byStaff[s.id];
                    return (
                      <td
                        key={s.id}
                        className="whitespace-nowrap py-2 pr-3 text-right font-mono font-bold"
                      >
                        {fmt(totals.byStaff[s.id] ?? 0)}
                        {amount !== undefined && (
                          <div className="text-xs font-normal text-white/40">{fmtCost(amount)}</div>
                        )}
                      </td>
                    );
                  })}
                  {canManage && (
                    <>
                      <td className="whitespace-nowrap py-2 pr-3 text-right font-mono font-bold">
                        {fmt(totals.total)}
                      </td>
                      {isAdmin && (
                        <td className="whitespace-nowrap py-2 pr-3 text-right font-mono font-bold">
                          {fmtCost(totalAmounts.total)}
                        </td>
                      )}
                      <td />
                    </>
                  )}
                </tr>
              </tbody>
            </table>
          </div>
          {hasPartial && (
            <p className="mt-2 font-mono text-xs text-white/40">
              * the picked range doesn't cover this whole pay period — widen it before paying out.
            </p>
          )}
        </div>
      )}

      {isAdmin && data && (
        <StipendsPanel
          staff={data.staff}
          stipends={data.stipends ?? []}
          overrides={data.stipendOverrides ?? []}
          onChanged={async () => {
            invalidateJson('/api/admin/schedule-board');
            await reload();
          }}
        />
      )}
    </div>
  );
}

async function readError(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/**
 * Admin-only one-week stipend adjustments, kept on the hours report because
 * the weeks are visible here. The recurring stipends themselves (add / edit /
 * end) are managed next to pay rates on /admin/users.
 */
function StipendsPanel({
  staff,
  stipends,
  overrides,
  onChanged,
}: {
  staff: StaffRow[];
  stipends: StaffStipendRow[];
  overrides: StipendOverrideRow[];
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [ovStipendId, setOvStipendId] = useState('');
  const [ovWeek, setOvWeek] = useState(() => weekStartOf(todayLocal()));
  const [ovHours, setOvHours] = useState('');
  const [ovNote, setOvNote] = useState('');

  const nameById = useMemo(() => new Map(staff.map((s) => [s.id, s.display_name])), [staff]);
  const stipendById = useMemo(() => new Map(stipends.map((s) => [s.id, s])), [stipends]);

  const call = async (method: string, body?: unknown, query = ''): Promise<boolean> => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/stipends${query}`, {
      method,
      ...(body !== undefined
        ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    });
    if (!res.ok) setError(await readError(res));
    await onChanged();
    setBusy(false);
    return res.ok;
  };

  const saveOverride = async (hours: number | null) => {
    const ok = await call('PUT', {
      stipendId: ovStipendId,
      weekStart: ovWeek,
      hours,
      note: ovNote.trim() || null,
    });
    if (ok) {
      setOvHours('');
      setOvNote('');
    }
  };

  const sortedOverrides = [...overrides].sort((a, b) => b.week_start.localeCompare(a.week_start));

  return (
    <div className="space-y-3 rounded border border-white/10 bg-white/[0.03] px-3 py-3">
      <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-white/40">
        Stipend hours
      </h2>
      <p className="font-mono text-xs text-white/40">
        Recurring weekly hours for off-schedule work, paid at the person's hourly rate and included
        in the table above. Add, edit, or end stipends next to pay rates on the{' '}
        <a href="/admin/users" className="underline hover:text-white">
          People page
        </a>
        ; adjust a single week here.
      </p>

      {error && (
        <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-red)]">
          {error}
        </p>
      )}

      {stipends.length === 0 ? (
        <p className="font-mono text-xs text-white/40">No stipends yet.</p>
      ) : (
        <div className="space-y-2">
          <p className="font-mono text-xs text-white/40">
            Replaces the stipend's hours for that week only — set 0 for a skipped week. Clearing
            puts the week back on the recurring amount.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <select
              className={inputClass}
              value={ovStipendId}
              disabled={busy}
              onChange={(e) => setOvStipendId(e.target.value)}
              aria-label="Stipend to adjust"
            >
              <option value="">stipend...</option>
              {stipends.map((s) => (
                <option key={s.id} value={s.id}>
                  {nameById.get(s.staff_id) ?? '?'} — {s.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 font-mono text-xs text-white/60">
              week of
              <input
                className={inputClass}
                type="date"
                value={ovWeek}
                disabled={busy}
                onChange={(e) => e.target.value && setOvWeek(weekStartOf(e.target.value))}
                aria-label="Week to adjust"
              />
            </label>
            <label className="flex items-center gap-1.5 font-mono text-xs text-white/60">
              <input
                className={`${inputClass} w-20`}
                type="number"
                min={0}
                max={40}
                step={0.1}
                placeholder="0"
                value={ovHours}
                disabled={busy}
                onChange={(e) => setOvHours(e.target.value)}
                aria-label="Hours for that week"
              />
              h
            </label>
            <input
              className={`${inputClass} w-56`}
              placeholder="note (optional)"
              value={ovNote}
              disabled={busy}
              onChange={(e) => setOvNote(e.target.value)}
              aria-label="Override note"
            />
            <button
              type="button"
              className={buttonClass}
              disabled={busy || !ovStipendId || ovHours.trim() === '' || Number(ovHours) < 0}
              onClick={() => void saveOverride(Number(ovHours))}
            >
              Set week
            </button>
          </div>

          {sortedOverrides.length > 0 && (
            <ul className="space-y-1">
              {sortedOverrides.map((o) => {
                const stipend = stipendById.get(o.stipend_id);
                return (
                  <li
                    key={o.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-white/60"
                  >
                    <span className="text-white/70">{o.week_start}</span>
                    <span>
                      {stipend ? (nameById.get(stipend.staff_id) ?? '?') : '?'} —{' '}
                      {stipend?.label ?? 'deleted stipend'}
                    </span>
                    <span className="text-white/70">
                      {fmt(o.hours)}h{stipend ? ` (usually ${fmt(stipend.hours_per_week)})` : ''}
                    </span>
                    {o.note && <span className="text-white/40">{o.note}</span>}
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={busy}
                      onClick={() =>
                        void call('PUT', {
                          stipendId: o.stipend_id,
                          weekStart: o.week_start,
                          hours: null,
                        })
                      }
                    >
                      Clear
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
