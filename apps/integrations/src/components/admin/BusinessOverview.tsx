// Business overview island for /admin/business (admin-only): KPI tiles for
// the last completed week, weekly revenue vs labor cost, per-open-hour
// unit economics, membership flows, and attendance. All numbers arrive
// pre-joined from /api/admin/business-overview (Momence report snapshots +
// labor cost from the shifts tables); this island only renders.
import { useState } from 'react';
import { useCachedJson } from '@/lib/client/cachedJson';
import type { BusinessOverviewPayload, BusinessWeek } from '@/pages/api/admin/business-overview';

const GOLD = '#b58d35';
const GRID = 'rgba(255, 255, 255, 0.08)';
const CREME = 'rgba(255, 255, 255, 0.65)';

const WINDOW_OPTIONS = [4, 8, 13, 26] as const;
const DEFAULT_WINDOW = 8;

const buttonClass =
  'px-3 py-1.5 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

const fmtMoney = (n: number): string =>
  `$${Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(2)}`;

const fmtCount = (n: number): string =>
  Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(1);

const fmtWeek = (d: string): string =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const fmtAxisDay = (d: string): string =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });

/** "+12% WoW" / "−8% WoW"; null when either week is missing. */
function wowDelta(current: number | null, previous: number | null): string | null {
  if (current === null || previous === null || previous === 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct >= 0 ? '+' : '−'}${Math.abs(pct)}% WoW`;
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-white/10 bg-white/[0.03] px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-wide text-white/40">{label}</p>
      <p className="mt-1 text-2xl font-bold text-[var(--pyre-creme)]">{value}</p>
      {sub && <p className="mt-0.5 font-mono text-xs text-white/40">{sub}</p>}
    </div>
  );
}

function Legend({ items }: { items: Array<{ color: string; label: string }> }) {
  return (
    <div className="flex flex-wrap gap-4">
      {items.map((item) => (
        <span
          key={item.label}
          className="flex items-center gap-1.5 font-mono text-xs text-white/50"
        >
          <span
            className="inline-block h-2 w-2 rounded-sm"
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

interface ChartFrame {
  W: number;
  H: number;
  LEFT: number;
  TOP: number;
  plotW: number;
  plotH: number;
  step: number;
}

const frame = (count: number): ChartFrame => {
  const W = 640;
  const H = 180;
  const LEFT = 46;
  const RIGHT = 12;
  const BOTTOM = 22;
  const TOP = 8;
  const plotW = W - LEFT - RIGHT;
  const plotH = H - TOP - BOTTOM;
  return { W, H, LEFT, TOP, plotW, plotH, step: count > 0 ? plotW / count : plotW };
};

/** Shared grid lines + x labels; children render the marks. */
function ChartShell({
  weeks,
  max,
  yLabel,
  ariaLabel,
  children,
}: {
  weeks: BusinessWeek[];
  max: number;
  yLabel: (v: number) => string;
  ariaLabel: string;
  children: (f: ChartFrame) => React.ReactNode;
}) {
  const f = frame(weeks.length);
  const gridLines = [0.25, 0.5, 0.75, 1].map((fr) => ({
    y: f.TOP + f.plotH - fr * f.plotH,
    label: yLabel(max * fr),
  }));
  const labelEvery = Math.ceil(weeks.length / 14);
  const firstFuture = weeks.findIndex((w) => w.future);

  return (
    <svg
      viewBox={`0 0 ${f.W} ${f.H}`}
      className="w-full max-w-[720px]"
      role="img"
      aria-label={ariaLabel}
    >
      {gridLines.map((g) => (
        <g key={g.y}>
          <line x1={f.LEFT} x2={f.W - 12} y1={g.y} y2={g.y} stroke={GRID} strokeWidth={1} />
          <text
            x={f.LEFT - 6}
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
          x1={f.LEFT + firstFuture * f.step}
          x2={f.LEFT + firstFuture * f.step}
          y1={f.TOP}
          y2={f.TOP + f.plotH}
          stroke="rgba(255,255,255,0.25)"
          strokeDasharray="4 4"
          strokeWidth={1}
        />
      )}
      {children(f)}
      {weeks.map((week, i) =>
        i % labelEvery === 0 || i === weeks.length - 1 ? (
          <text
            key={week.weekStart}
            x={f.LEFT + i * f.step + f.step / 2}
            y={f.H - 8}
            textAnchor="middle"
            className="fill-white/40 font-mono"
            fontSize={9}
          >
            {fmtAxisDay(week.weekStart)}
          </text>
        ) : null
      )}
    </svg>
  );
}

/** Revenue bars (gold) with a narrower labor-cost bar overlaid (creme). */
function RevenueVsLaborChart({ weeks }: { weeks: BusinessWeek[] }) {
  const max = Math.max(...weeks.map((w) => Math.max(w.revenue ?? 0, w.laborCost)), 1);
  return (
    <ChartShell
      weeks={weeks}
      max={max}
      yLabel={(v) => `$${Math.round(v / 10) * 10}`}
      ariaLabel="Weekly revenue vs labor cost"
    >
      {(f) => (
        <>
          {weeks.map((week, i) => {
            const barW = Math.min(f.step * 0.6, 48);
            const x = f.LEFT + i * f.step + (f.step - barW) / 2;
            const revenueH = week.revenue !== null ? (week.revenue / max) * f.plotH : 0;
            const laborH = (week.laborCost / max) * f.plotH;
            const dim = week.future ? 0.35 : 0.85;
            return (
              <g key={week.weekStart}>
                {week.revenue !== null && (
                  <rect
                    x={x}
                    y={f.TOP + f.plotH - revenueH}
                    width={barW}
                    height={revenueH}
                    fill={GOLD}
                    opacity={dim}
                  >
                    <title>
                      {`Week of ${fmtWeek(week.weekStart)}${week.future ? ' (in progress)' : ''}: revenue ${fmtMoney(week.revenue)} · labor ${fmtMoney(week.laborCost)}${week.laborPctOfRevenue !== null ? ` (${week.laborPctOfRevenue}% of revenue)` : ''}`}
                    </title>
                  </rect>
                )}
                <rect
                  x={x + barW * 0.3}
                  y={f.TOP + f.plotH - laborH}
                  width={barW * 0.4}
                  height={laborH}
                  fill={CREME}
                  opacity={week.future ? 0.3 : 0.6}
                >
                  <title>{`Week of ${fmtWeek(week.weekStart)}: labor ${fmtMoney(week.laborCost)}`}</title>
                </rect>
              </g>
            );
          })}
        </>
      )}
    </ChartShell>
  );
}

/** Two per-open-hour lines: revenue (gold) and labor cost (creme, the
 * break-even line). Gaps where a week has no revenue snapshot. */
function UnitEconomicsChart({ weeks }: { weeks: BusinessWeek[] }) {
  const values = weeks.flatMap((w) => [w.revenuePerOpenHour ?? 0, w.costPerOpenHour ?? 0]);
  const max = Math.max(...values, 1);
  const line = (pick: (w: BusinessWeek) => number | null, f: ChartFrame): string[] => {
    // Split into segments at nulls so missing weeks read as gaps, not zeros.
    const segments: string[][] = [[]];
    weeks.forEach((week, i) => {
      const value = pick(week);
      if (value === null) {
        if (segments[segments.length - 1].length > 0) segments.push([]);
        return;
      }
      const x = f.LEFT + i * f.step + f.step / 2;
      const y = f.TOP + f.plotH - (value / max) * f.plotH;
      segments[segments.length - 1].push(`${x},${y}`);
    });
    return segments.filter((s) => s.length > 0).map((s) => s.join(' '));
  };
  return (
    <ChartShell
      weeks={weeks}
      max={max}
      yLabel={(v) => `$${Math.round(v)}`}
      ariaLabel="Revenue and labor cost per open hour"
    >
      {(f) => (
        <>
          {line((w) => w.costPerOpenHour, f).map((points) => (
            <polyline
              key={`c${points}`}
              points={points}
              fill="none"
              stroke={CREME}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {line((w) => w.revenuePerOpenHour, f).map((points) => (
            <polyline
              key={`r${points}`}
              points={points}
              fill="none"
              stroke={GOLD}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
        </>
      )}
    </ChartShell>
  );
}

/** New members up (gold) vs cancellations down-styled (creme) side by side. */
function MembershipChart({ weeks }: { weeks: BusinessWeek[] }) {
  const max = Math.max(...weeks.flatMap((w) => [w.newMembers ?? 0, w.cancellations ?? 0]), 1);
  return (
    <ChartShell
      weeks={weeks}
      max={max}
      yLabel={(v) => String(Math.round(v))}
      ariaLabel="New members vs cancellations"
    >
      {(f) => (
        <>
          {weeks.map((week, i) => {
            const pairW = Math.min(f.step * 0.6, 40);
            const barW = pairW / 2;
            const x = f.LEFT + i * f.step + (f.step - pairW) / 2;
            const newH = ((week.newMembers ?? 0) / max) * f.plotH;
            const cancelH = ((week.cancellations ?? 0) / max) * f.plotH;
            const dim = week.future ? 0.35 : 0.85;
            return (
              <g key={week.weekStart}>
                <rect
                  x={x}
                  y={f.TOP + f.plotH - newH}
                  width={barW - 1}
                  height={newH}
                  fill={GOLD}
                  opacity={dim}
                >
                  <title>{`Week of ${fmtWeek(week.weekStart)}: ${week.newMembers ?? '—'} new · ${week.cancellations ?? '—'} cancelled${week.activeMembers !== null ? ` · ${week.activeMembers} active` : ''}`}</title>
                </rect>
                <rect
                  x={x + barW}
                  y={f.TOP + f.plotH - cancelH}
                  width={barW - 1}
                  height={cancelH}
                  fill={CREME}
                  opacity={week.future ? 0.3 : 0.6}
                >
                  <title>{`Week of ${fmtWeek(week.weekStart)}: ${week.cancellations ?? '—'} cancelled`}</title>
                </rect>
              </g>
            );
          })}
        </>
      )}
    </ChartShell>
  );
}

/** Attendance bars with a thin no-show overlay; occupancy in the tooltip. */
function AttendanceChart({ weeks }: { weeks: BusinessWeek[] }) {
  const max = Math.max(...weeks.map((w) => w.attendance ?? 0), 1);
  return (
    <ChartShell
      weeks={weeks}
      max={max}
      yLabel={(v) => String(Math.round(v))}
      ariaLabel="Weekly attendance"
    >
      {(f) => (
        <>
          {weeks.map((week, i) => {
            const barW = Math.min(f.step * 0.6, 48);
            const x = f.LEFT + i * f.step + (f.step - barW) / 2;
            const attendH = ((week.attendance ?? 0) / max) * f.plotH;
            const noShowH = ((week.noShows ?? 0) / max) * f.plotH;
            const dim = week.future ? 0.35 : 0.85;
            return (
              <g key={week.weekStart}>
                {week.attendance !== null && (
                  <rect
                    x={x}
                    y={f.TOP + f.plotH - attendH}
                    width={barW}
                    height={attendH}
                    fill={GOLD}
                    opacity={dim}
                  >
                    <title>
                      {`Week of ${fmtWeek(week.weekStart)}${week.future ? ' (in progress)' : ''}: ${fmtCount(week.attendance)} visits${week.occupancyPct !== null ? ` · ${week.occupancyPct}% occupancy` : ''}${week.noShows !== null ? ` · ${fmtCount(week.noShows)} no-shows` : ''}`}
                    </title>
                  </rect>
                )}
                {week.noShows !== null && week.noShows > 0 && (
                  <rect
                    x={x + barW * 0.35}
                    y={f.TOP + f.plotH - noShowH}
                    width={barW * 0.3}
                    height={noShowH}
                    fill={CREME}
                    opacity={week.future ? 0.3 : 0.6}
                  >
                    <title>{`Week of ${fmtWeek(week.weekStart)}: ${fmtCount(week.noShows)} no-shows`}</title>
                  </rect>
                )}
              </g>
            );
          })}
        </>
      )}
    </ChartShell>
  );
}

export function BusinessOverview() {
  const [windowWeeks, setWindowWeeks] = useState<number>(DEFAULT_WINDOW);

  // One cache entry per window, so switching back to a window you already
  // viewed repaints from cache while it revalidates behind you.
  const { data, error, loading, refreshing } = useCachedJson<BusinessOverviewPayload>(
    `/api/admin/business-overview?weeks=${windowWeeks}`
  );

  if (loading) return <p className="font-mono text-sm text-white/40">Loading…</p>;
  if (error || !data) {
    return (
      <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-red)]">
        {error ?? 'Failed to load'}
      </p>
    );
  }

  const completed = data.weeks.filter((w) => !w.future);
  const lastWeek = completed[completed.length - 1] ?? null;
  const prevWeek = completed[completed.length - 2] ?? null;

  // Freshness: the sync runs daily, so anything past ~26h means it's unwell.
  const syncStale =
    data.lastSyncedAt !== null &&
    Date.now() - new Date(data.lastSyncedAt).getTime() > 26 * 60 * 60 * 1000;
  const neverSynced = data.lastSyncedAt === null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs uppercase tracking-wide text-white/40">History</span>
        {WINDOW_OPTIONS.map((w) => (
          <button
            key={w}
            type="button"
            className={`${buttonClass} ${windowWeeks === w ? 'border-white/40 text-white' : ''}`}
            aria-pressed={windowWeeks === w}
            disabled={loading || refreshing}
            onClick={() => setWindowWeeks(w)}
          >
            {w} wks
          </button>
        ))}
        {refreshing && <span className="font-mono text-xs text-white/40">Loading…</span>}
      </div>

      {(neverSynced || syncStale || data.missingReportTypes.length > 0) && (
        <div className="rounded border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-gold)] space-y-1">
          {neverSynced && (
            <p>
              No Momence report snapshots yet — the daily sync hasn't run. Kick it off with the
              business-report-sync cron job or the backfill endpoint.
            </p>
          )}
          {syncStale && data.lastSyncedAt && (
            <p>
              Last Momence sync was {new Date(data.lastSyncedAt).toLocaleString()} — over a day ago.
            </p>
          )}
          {data.missingReportTypes.length > 0 && (
            <p>
              No recent snapshot for: {data.missingReportTypes.join(', ')} — those metrics show as
              missing. (Report type unavailable on the Momence plan, or its runs are failing.)
            </p>
          )}
        </div>
      )}

      {/* ---- KPI tiles (last completed week) ---- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile
          label="Revenue (last week)"
          value={lastWeek?.revenue != null ? fmtMoney(lastWeek.revenue) : '—'}
          sub={
            wowDelta(lastWeek?.revenue ?? null, prevWeek?.revenue ?? null) ??
            (lastWeek ? `week of ${fmtWeek(lastWeek.weekStart)}` : undefined)
          }
        />
        <StatTile
          label="Revenue / open hour"
          value={lastWeek?.revenuePerOpenHour != null ? fmtMoney(lastWeek.revenuePerOpenHour) : '—'}
          sub={
            lastWeek?.costPerOpenHour != null
              ? `vs ${fmtMoney(lastWeek.costPerOpenHour)} labor break-even`
              : undefined
          }
        />
        <StatTile
          label="Labor % of revenue"
          value={lastWeek?.laborPctOfRevenue != null ? `${lastWeek.laborPctOfRevenue}%` : '—'}
          sub={lastWeek ? `${fmtMoney(lastWeek.laborCost)} labor cost` : undefined}
        />
        <StatTile
          label="Active members"
          value={lastWeek?.activeMembers != null ? fmtCount(lastWeek.activeMembers) : '—'}
          sub={
            wowDelta(lastWeek?.activeMembers ?? null, prevWeek?.activeMembers ?? null) ?? undefined
          }
        />
        <StatTile
          label="Visits (last week)"
          value={lastWeek?.attendance != null ? fmtCount(lastWeek.attendance) : '—'}
          sub={lastWeek?.occupancyPct != null ? `${lastWeek.occupancyPct}% occupancy` : undefined}
        />
      </div>

      {/* ---- Revenue vs labor ---- */}
      <section className="space-y-2">
        <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-white/40">
          Weekly revenue vs labor cost
        </h2>
        <Legend
          items={[
            { color: GOLD, label: 'revenue' },
            { color: CREME, label: 'labor cost' },
          ]}
        />
        <RevenueVsLaborChart weeks={data.weeks} />
        <p className="font-mono text-xs text-white/40">
          Dimmed bars are the in-progress week — partial numbers. Missing revenue bars mean no
          Momence snapshot covers that week yet.
        </p>
      </section>

      {/* ---- Unit economics ---- */}
      <section className="space-y-2">
        <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-white/40">
          Per open hour: revenue vs labor break-even
        </h2>
        <Legend
          items={[
            { color: GOLD, label: 'revenue / open hour' },
            { color: CREME, label: 'labor cost / open hour (break-even)' },
          ]}
        />
        <UnitEconomicsChart weeks={data.weeks} />
        <p className="font-mono text-xs text-white/40">
          Gold above the dashed line means the customer-facing hours pay for the labor staffing
          them.
        </p>
      </section>

      {/* ---- Memberships ---- */}
      <section className="space-y-2">
        <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-white/40">
          Memberships: new vs cancelled
        </h2>
        <Legend
          items={[
            { color: GOLD, label: 'new members' },
            { color: CREME, label: 'cancellations' },
          ]}
        />
        <MembershipChart weeks={data.weeks} />
      </section>

      {/* ---- Attendance ---- */}
      <section className="space-y-2">
        <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-white/40">
          Attendance
        </h2>
        <Legend
          items={[
            { color: GOLD, label: 'visits' },
            { color: CREME, label: 'no-shows' },
          ]}
        />
        <AttendanceChart weeks={data.weeks} />
      </section>
    </div>
  );
}
