// Staffing insights island for /admin/schedule/insights (admin-only): stat
// tiles for the current/next pay period and weekly averages, a weekly labor
// cost bar chart, per-person consistency vs their own target (sparklines),
// and unmet demand (denied requests, subbed-away shifts). All numbers arrive
// pre-computed from /api/admin/schedule-insights; this island only renders.
import { addDays, weekStartOf } from '@pyre/schedule-core';
import { useCallback, useEffect, useState } from 'react';
import type { ScheduleInsightsPayload } from '@/pages/api/admin/schedule-insights';

const GOLD = '#b58d35';
const GRID = 'rgba(255, 255, 255, 0.08)';

/** Lookback choices (completed Mon–Sun weeks); forecast tiles ignore this. */
const WINDOW_OPTIONS = [4, 8, 13, 26] as const;
const DEFAULT_WINDOW = 8;

const buttonClass =
  'px-3 py-1.5 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

const inputClass =
  'px-3 py-1.5 rounded bg-white/5 border border-white/10 text-xs text-[var(--pyre-creme)] focus:outline-none focus:border-white/30';

const todayLocal = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
};

const fmtCost = (cost: number): string =>
  `$${Number.isInteger(cost) ? cost.toLocaleString('en-US') : cost.toFixed(2)}`;

const fmtHours = (hours: number): string =>
  Number.isInteger(hours) ? String(hours) : hours.toFixed(1);

/** "Aug 3 – Aug 16" from two YYYY-MM-DD dates. */
const fmtRange = (start: string, end: string): string => {
  const day = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${day(start)} – ${day(end)}`;
};

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-white/10 bg-white/[0.03] px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-wide text-white/40">{label}</p>
      <p className="mt-1 text-2xl font-bold text-[var(--pyre-creme)]">{value}</p>
      {sub && <p className="mt-0.5 font-mono text-xs text-white/40">{sub}</p>}
    </div>
  );
}

/** Tiny weekly-hours trend with a dashed line at the person's target. */
function Sparkline({ values, target }: { values: number[]; target: number | null }) {
  const W = 120;
  const H = 28;
  const max = Math.max(...values, target ?? 0, 1);
  const y = (v: number) => H - 2 - (v / max) * (H - 6);
  const points = values
    .map((v, i) => `${(i / Math.max(values.length - 1, 1)) * W},${y(v)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-7 w-[120px]" role="img" aria-label="weekly hours">
      {target != null && (
        <line
          x1={0}
          x2={W}
          y1={y(target)}
          y2={y(target)}
          stroke="rgba(255,255,255,0.25)"
          strokeDasharray="3 3"
          strokeWidth={1}
        />
      )}
      <polyline
        points={points}
        fill="none"
        stroke={GOLD}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Weekly labor cost bars; future/partial weeks render dimmed. */
function CostChart({ weeks }: { weeks: ScheduleInsightsPayload['weeks'] }) {
  const W = 640;
  const H = 180;
  const LEFT = 46;
  const RIGHT = 12;
  const BOTTOM = 22;
  const TOP = 8;
  const plotW = W - LEFT - RIGHT;
  const plotH = H - TOP - BOTTOM;
  const max = Math.max(...weeks.map((w) => w.cost), 1);
  const step = weeks.length > 0 ? plotW / weeks.length : plotW;
  const barW = Math.min(step * 0.6, 48);
  const gridLines = [0.25, 0.5, 0.75, 1].map((f) => ({
    y: TOP + plotH - f * plotH,
    label: `$${Math.round((max * f) / 10) * 10}`,
  }));
  const firstFuture = weeks.findIndex((w) => w.future);
  // Long windows crowd the axis — label every Nth bar (last bar always).
  const labelEvery = Math.ceil(weeks.length / 14);
  const label = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full max-w-[720px]"
      role="img"
      aria-label="Weekly labor cost"
    >
      {gridLines.map((g) => (
        <g key={g.y}>
          <line x1={LEFT} x2={W - RIGHT} y1={g.y} y2={g.y} stroke={GRID} strokeWidth={1} />
          <text
            x={LEFT - 6}
            y={g.y + 3}
            textAnchor="end"
            className="fill-white/40 font-mono"
            fontSize={9}
          >
            {g.label}
          </text>
        </g>
      ))}
      {firstFuture > 0 && (
        <line
          x1={LEFT + firstFuture * step}
          x2={LEFT + firstFuture * step}
          y1={TOP}
          y2={TOP + plotH}
          stroke="rgba(255,255,255,0.25)"
          strokeDasharray="4 4"
          strokeWidth={1}
        />
      )}
      {weeks.map((week, i) => {
        const h = (week.cost / max) * plotH;
        const x = LEFT + i * step + (step - barW) / 2;
        return (
          <g key={week.weekStart}>
            <rect
              x={x}
              y={TOP + plotH - h}
              width={barW}
              height={h}
              fill={GOLD}
              opacity={week.future ? 0.35 : 0.85}
            >
              <title>
                {`Week of ${week.weekStart}${week.future ? ' (in progress)' : ''}: ${fmtCost(week.cost)} · ${fmtHours(week.paidHours)} paid h · ${fmtHours(week.openHours)} open h`}
              </title>
            </rect>
            {(i % labelEvery === 0 || i === weeks.length - 1) && (
              <text
                x={x + barW / 2}
                y={H - 8}
                textAnchor="middle"
                className="fill-white/40 font-mono"
                fontSize={9}
              >
                {label(week.weekStart)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function ScheduleInsights() {
  const [data, setData] = useState<ScheduleInsightsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [windowWeeks, setWindowWeeks] = useState<number | 'custom'>(DEFAULT_WINDOW);
  // Custom range defaults to the standard window so switching modes starts
  // from familiar numbers instead of an empty chart.
  const [customStart, setCustomStart] = useState(() =>
    addDays(weekStartOf(todayLocal()), -7 * DEFAULT_WINDOW)
  );
  const [customEnd, setCustomEnd] = useState(() => todayLocal());
  const customValid = customStart !== '' && customEnd !== '' && customStart <= customEnd;

  const load = useCallback(async () => {
    if (windowWeeks === 'custom' && !customValid) return;
    const query =
      windowWeeks === 'custom' ? `start=${customStart}&end=${customEnd}` : `weeks=${windowWeeks}`;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/schedule-insights?${query}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as ScheduleInsightsPayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [windowWeeks, customStart, customEnd, customValid]);

  useEffect(() => {
    void load();
  }, [load]);

  const windowPicker = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-xs uppercase tracking-wide text-white/40">History</span>
      {WINDOW_OPTIONS.map((w) => (
        <button
          key={w}
          type="button"
          className={`${buttonClass} ${windowWeeks === w ? 'border-white/40 text-white' : ''}`}
          aria-pressed={windowWeeks === w}
          disabled={loading}
          onClick={() => setWindowWeeks(w)}
        >
          {w} wks
        </button>
      ))}
      <button
        type="button"
        className={`${buttonClass} ${windowWeeks === 'custom' ? 'border-white/40 text-white' : ''}`}
        aria-pressed={windowWeeks === 'custom'}
        disabled={loading}
        onClick={() => setWindowWeeks('custom')}
      >
        Custom
      </button>
      {windowWeeks === 'custom' && (
        <>
          <input
            type="date"
            className={inputClass}
            value={customStart}
            onChange={(e) => e.target.value && setCustomStart(e.target.value)}
            aria-label="Custom range start"
          />
          <span className="font-mono text-xs text-white/40">to</span>
          <input
            type="date"
            className={inputClass}
            value={customEnd}
            onChange={(e) => e.target.value && setCustomEnd(e.target.value)}
            aria-label="Custom range end"
          />
          {!customValid && (
            <span className="font-mono text-xs text-[var(--pyre-gold)]">
              end must be on or after start
            </span>
          )}
        </>
      )}
      {loading && data && <span className="font-mono text-xs text-white/40">Loading…</span>}
    </div>
  );

  if (loading && !data) return <p className="font-mono text-sm text-white/40">Loading…</p>;
  if (error || !data) {
    return (
      <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-red)]">
        {error ?? 'Failed to load'}
      </p>
    );
  }

  const current = data.periods.find((p) => p.status === 'current');
  const next = data.periods.find((p) => p.status === 'next');
  const completed = data.weeks.filter((w) => !w.future);
  const avgWeeklyCost =
    completed.length > 0 ? completed.reduce((a, w) => a + w.cost, 0) / completed.length : 0;
  const totalOpen = completed.reduce((a, w) => a + w.openHours, 0);
  const avgCostPerOpenHour =
    totalOpen > 0 ? completed.reduce((a, w) => a + w.cost, 0) / totalOpen : null;

  const flagged = data.consistency.filter((c) => c.underTarget || c.inconsistent);
  const unflagged = data.consistency.filter((c) => !c.underTarget && !c.inconsistent);
  const demandRows = data.demand.filter(
    (d) => d.pending + d.denied + d.subsGivenAway + d.subsOpen + d.subsClaimed > 0
  );

  return (
    <div className="space-y-8">
      {windowPicker}

      {/* ---- Cost tiles ---- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Current pay period"
          value={current ? fmtCost(current.cost) : '—'}
          sub={
            current
              ? `${fmtRange(current.periodStart, current.periodEnd)} · paid ${current.payday}`
              : undefined
          }
        />
        <StatTile
          label="Next period forecast"
          value={next ? fmtCost(next.cost) : '—'}
          sub={`scheduled through ${data.scheduledThrough} — partial`}
        />
        <StatTile
          label="Avg weekly cost"
          value={fmtCost(Math.round(avgWeeklyCost))}
          sub={`${completed.length} completed weeks in window`}
        />
        <StatTile
          label="Cost per open hour"
          value={
            avgCostPerOpenHour == null ? '—' : fmtCost(Math.round(avgCostPerOpenHour * 100) / 100)
          }
          sub="labor ÷ customer-facing hours — revenue/hr to break even"
        />
      </div>

      {/* ---- Cost trend ---- */}
      <section className="space-y-2">
        <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-white/40">
          Weekly labor cost
        </h2>
        <CostChart weeks={data.weeks} />
        <p className="font-mono text-xs text-white/40">
          Dimmed bars are in-progress or future weeks — partial numbers until scheduled and worked.
        </p>
      </section>

      {/* ---- Consistency ---- */}
      <section className="space-y-2">
        <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-white/40">
          Hours consistency ({data.historyWeekStarts.length} completed weeks)
        </h2>
        <p className="font-mono text-xs text-white/40">
          Targets are set per person on{' '}
          <a href="/admin/users" className="underline hover:text-white">
            /admin/users
          </a>{' '}
          — main-gig and side-gig staff have different expectations, so flags compare each person to
          their own target.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left font-mono text-xs uppercase tracking-wide text-white/40">
                <th className="py-2 pr-3">Person</th>
                <th className="py-2 pr-3">Weekly hours</th>
                <th className="py-2 pr-3 text-right">Avg h/wk</th>
                <th className="py-2 pr-3 text-right">Target</th>
                <th className="py-2">Flags</th>
              </tr>
            </thead>
            <tbody>
              {[...flagged, ...unflagged].map((row) => {
                // Weeks before someone joined are excluded server-side, so a
                // short sparkline (or none) means "recent hire", not slacking.
                const isNew = row.weeksTracked < data.historyWeekStarts.length;
                return (
                  <tr key={row.staffId} className="border-b border-white/5">
                    <td className="py-2 pr-3 font-mono text-white/70">
                      {row.name}
                      {isNew && (
                        <span
                          className="ml-2 rounded border border-white/20 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-white/50"
                          title={`Joined recently — stats cover their ${row.weeksTracked} week${row.weeksTracked === 1 ? '' : 's'} on the roster, not the full window`}
                        >
                          new
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {row.weeksTracked === 0 ? (
                        <span className="font-mono text-xs text-white/25">no weeks yet</span>
                      ) : (
                        <Sparkline values={row.weekly} target={row.target} />
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">
                      {row.weeksTracked === 0 ? '—' : fmtHours(row.avg)}
                      {isNew && row.weeksTracked > 0 && (
                        <span className="ml-1 text-xs text-white/40">({row.weeksTracked}w)</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-white/60">
                      {row.target == null ? '—' : fmtHours(row.target)}
                    </td>
                    <td className="py-2 font-mono text-xs">
                      {row.underTarget && (
                        <span className="mr-2 text-[var(--pyre-gold)]">
                          avg {fmtHours(row.avg)} vs target {fmtHours(row.target ?? 0)}
                        </span>
                      )}
                      {row.inconsistent && <span className="text-white/50">choppy weeks</span>}
                      {!row.underTarget && !row.inconsistent && (
                        <span className="text-white/25">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- Demand ---- */}
      <section className="space-y-2">
        <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-white/40">
          Unmet demand &amp; subs
        </h2>
        <p className="font-mono text-xs text-white/40">
          Shift requests exist since mid-Aug 2026 — counts cover that window, not the full history.
          Denied requests mean someone asked to work and didn't get the shift.
        </p>
        {demandRows.length === 0 ? (
          <p className="font-mono text-sm text-white/40">No requests or subs in this window.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left font-mono text-xs uppercase tracking-wide text-white/40">
                  <th className="py-2 pr-3">Person</th>
                  <th className="py-2 pr-3 text-right">Pending</th>
                  <th className="py-2 pr-3 text-right">Denied</th>
                  <th className="py-2 pr-3 text-right">Approved</th>
                  <th className="py-2 pr-3 text-right">Subs given away</th>
                  <th className="py-2 text-right">Subs claimed</th>
                </tr>
              </thead>
              <tbody>
                {demandRows.map((row) => (
                  <tr key={row.staffId} className="border-b border-white/5">
                    <td className="py-2 pr-3 font-mono text-white/70">{row.name}</td>
                    <td className="py-2 pr-3 text-right font-mono">{row.pending || '—'}</td>
                    <td
                      className={`py-2 pr-3 text-right font-mono ${row.denied > 0 ? 'text-[var(--pyre-gold)]' : ''}`}
                      title={
                        row.deniedRecent.length > 0
                          ? `Recently denied: ${row.deniedRecent
                              .map((d) => `${d.shiftDate} ${d.label}`.trim())
                              .join(', ')}`
                          : undefined
                      }
                    >
                      {row.denied || '—'}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">{row.approved || '—'}</td>
                    <td className="py-2 pr-3 text-right font-mono">
                      {row.subsGivenAway + row.subsOpen > 0
                        ? `${row.subsGivenAway}${row.subsOpen > 0 ? ` (+${row.subsOpen} open)` : ''}`
                        : '—'}
                    </td>
                    <td className="py-2 text-right font-mono">{row.subsClaimed || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
