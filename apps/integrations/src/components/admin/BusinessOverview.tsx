// Business overview island for /admin/business (admin-only): KPI tiles for
// the selected date range (with deltas against the equal-length period
// before), revenue vs labor cost, per-open-hour unit economics, membership
// flows, and attendance — over any preset or custom date range, grouped by
// day, week, or month. All numbers arrive pre-joined from
// /api/admin/business-overview (Momence metric syncs + labor cost from the
// shifts tables); this island only renders.
import { addDays, utcToEastern, weekStartOf } from '@pyre/schedule-core';
import { useEffect, useState } from 'react';
import { BusinessCosts } from '@/components/admin/BusinessCosts';
import { invalidateJson, useCachedJson } from '@/lib/client/cachedJson';
import { fmtDateTime, timeAgo } from '@/lib/client/relativeTime';
import type {
  BucketGroup,
  BusinessBucket,
  BusinessOverviewPayload,
  SyncStatus,
} from '@/pages/api/admin/business-overview';
import type { BusinessSyncResponse } from '@/pages/api/admin/business-sync';

const GOLD = '#b58d35';
const GRID = 'rgba(255, 255, 255, 0.08)';
const CREME = 'rgba(255, 255, 255, 0.65)';

const buttonClass =
  'px-3 py-1.5 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

const inputClass =
  'px-3 py-1.5 rounded bg-white/5 border border-white/10 text-xs text-[var(--pyre-creme)] focus:outline-none focus:border-white/30';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// --- Date range presets (all ET wall-clock, same calendar as the API) ---

type PresetKey =
  | 'this-week'
  | 'last-week'
  | 'this-month'
  | 'last-month'
  | 'this-quarter'
  | 'last-quarter'
  | 'last-12-weeks'
  | 'ytd'
  | 'custom';

const PRESETS: Array<{ key: PresetKey; label: string }> = [
  { key: 'this-week', label: 'This week' },
  { key: 'last-week', label: 'Last week' },
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'this-quarter', label: 'This qtr' },
  { key: 'last-quarter', label: 'Last qtr' },
  { key: 'last-12-weeks', label: '12 wks' },
  { key: 'ytd', label: 'YTD' },
  { key: 'custom', label: 'Custom' },
];

const monthStartOf = (date: string): string => `${date.slice(0, 7)}-01`;

/** First of the month `n` months after the one containing `monthStart`. */
function addMonths(monthStart: string, n: number): string {
  const year = Number(monthStart.slice(0, 4));
  const month = Number(monthStart.slice(5, 7)) - 1 + n;
  const y = year + Math.floor(month / 12);
  const m = ((month % 12) + 12) % 12;
  return `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

function quarterStartOf(date: string): string {
  const month = Number(date.slice(5, 7));
  const qMonth = month - ((month - 1) % 3);
  return `${date.slice(0, 4)}-${String(qMonth).padStart(2, '0')}-01`;
}

/** A preset's range plus the grain it reads best at (overridable). */
function presetRange(
  key: Exclude<PresetKey, 'custom'>,
  today: string
): { start: string; end: string; group: BucketGroup } {
  const thisWeek = weekStartOf(today);
  switch (key) {
    case 'this-week':
      return { start: thisWeek, end: addDays(thisWeek, 6), group: 'day' };
    case 'last-week':
      return { start: addDays(thisWeek, -7), end: addDays(thisWeek, -1), group: 'day' };
    case 'this-month': {
      const start = monthStartOf(today);
      return { start, end: addDays(addMonths(start, 1), -1), group: 'day' };
    }
    case 'last-month': {
      const start = addMonths(monthStartOf(today), -1);
      return { start, end: addDays(monthStartOf(today), -1), group: 'day' };
    }
    case 'this-quarter': {
      const start = quarterStartOf(today);
      return { start, end: addDays(addMonths(start, 3), -1), group: 'week' };
    }
    case 'last-quarter': {
      const start = addMonths(quarterStartOf(today), -3);
      return { start, end: addDays(quarterStartOf(today), -1), group: 'week' };
    }
    case 'last-12-weeks':
      return { start: addDays(thisWeek, -7 * 12), end: addDays(thisWeek, 6), group: 'week' };
    case 'ytd':
      return { start: `${today.slice(0, 4)}-01-01`, end: today, group: 'month' };
  }
}

// --- Formatting ---

const fmtMoney = (n: number): string =>
  `$${Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(2)}`;

const fmtCount = (n: number): string =>
  Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(1);

const fmtDay = (d: string): string =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const fmtRange = (start: string, end: string): string =>
  start === end ? fmtDay(start) : `${fmtDay(start)} – ${fmtDay(end)}`;

/** Axis tick for a bucket: 8/12 for days/weeks, Aug for months. */
const fmtAxis = (d: string, group: BucketGroup): string =>
  group === 'month'
    ? new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short' })
    : new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });

/** Tooltip name for a bucket: the day, "Week of …", or "August 2026". */
function bucketLabel(bucket: BusinessBucket, group: BucketGroup): string {
  if (group === 'day') return fmtDay(bucket.start);
  if (group === 'week') return `Week of ${fmtDay(bucket.start)}`;
  return new Date(`${bucket.start}T00:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

/** "+12% vs prior" / "−8% vs prior"; null when either period is missing. */
function periodDelta(current: number | null, previous: number | null): string | null {
  if (current === null || previous === null || previous === 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct >= 0 ? '+' : '−'}${Math.abs(pct)}% vs prior`;
}

function StatTile({
  label,
  value,
  sub,
  bad,
}: {
  label: string;
  value: string;
  sub?: string;
  /** Renders the value in the warning red — a loss, not a number. */
  bad?: boolean;
}) {
  return (
    <div className="rounded border border-white/10 bg-white/[0.03] px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-wide text-white/40">{label}</p>
      <p
        className={`mt-1 text-2xl font-bold ${bad ? 'text-[var(--pyre-red)]' : 'text-[var(--pyre-creme)]'}`}
      >
        {value}
      </p>
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
  buckets,
  group,
  max,
  yLabel,
  ariaLabel,
  children,
}: {
  buckets: BusinessBucket[];
  group: BucketGroup;
  max: number;
  yLabel: (v: number) => string;
  ariaLabel: string;
  children: (f: ChartFrame) => React.ReactNode;
}) {
  const f = frame(buckets.length);
  const gridLines = [0.25, 0.5, 0.75, 1].map((fr) => ({
    y: f.TOP + f.plotH - fr * f.plotH,
    label: yLabel(max * fr),
  }));
  const labelEvery = Math.ceil(buckets.length / 14);
  const firstFuture = buckets.findIndex((b) => b.future);

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
      {buckets.map((bucket, i) =>
        i % labelEvery === 0 || i === buckets.length - 1 ? (
          <text
            key={bucket.start}
            x={f.LEFT + i * f.step + f.step / 2}
            y={f.H - 8}
            textAnchor="middle"
            className="fill-white/40 font-mono"
            fontSize={9}
          >
            {fmtAxis(bucket.start, group)}
          </text>
        ) : null
      )}
    </svg>
  );
}

/** Revenue bars (gold) with a narrower labor-cost bar overlaid (creme). */
function RevenueVsLaborChart({
  buckets,
  group,
}: {
  buckets: BusinessBucket[];
  group: BucketGroup;
}) {
  const max = Math.max(...buckets.map((b) => Math.max(b.revenue ?? 0, b.laborCost)), 1);
  return (
    <ChartShell
      buckets={buckets}
      group={group}
      max={max}
      yLabel={(v) => `$${Math.round(v / 10) * 10}`}
      ariaLabel="Revenue vs labor cost"
    >
      {(f) => (
        <>
          {buckets.map((bucket, i) => {
            const barW = Math.min(f.step * 0.6, 48);
            const x = f.LEFT + i * f.step + (f.step - barW) / 2;
            const revenueH = bucket.revenue !== null ? (bucket.revenue / max) * f.plotH : 0;
            const laborH = (bucket.laborCost / max) * f.plotH;
            const dim = bucket.future ? 0.35 : 0.85;
            const label = bucketLabel(bucket, group);
            return (
              <g key={bucket.start}>
                {bucket.revenue !== null && (
                  <rect
                    x={x}
                    y={f.TOP + f.plotH - revenueH}
                    width={barW}
                    height={revenueH}
                    fill={GOLD}
                    opacity={dim}
                  >
                    <title>
                      {`${label}${bucket.future ? ' (in progress)' : ''}: revenue ${fmtMoney(bucket.revenue)} · labor ${fmtMoney(bucket.laborCost)}${bucket.laborPctOfRevenue !== null ? ` (${bucket.laborPctOfRevenue}% of revenue)` : ''}`}
                    </title>
                  </rect>
                )}
                <rect
                  x={x + barW * 0.3}
                  y={f.TOP + f.plotH - laborH}
                  width={barW * 0.4}
                  height={laborH}
                  fill={CREME}
                  opacity={bucket.future ? 0.3 : 0.6}
                >
                  <title>{`${label}: labor ${fmtMoney(bucket.laborCost)}`}</title>
                </rect>
              </g>
            );
          })}
        </>
      )}
    </ChartShell>
  );
}

/** Revenue bars (gold) with the full cost stack overlaid (creme): labor plus
 * amortized operating costs. The visible gap between the bars IS the profit;
 * the tooltip spells it out. */
function RevenueVsCostChart({ buckets, group }: { buckets: BusinessBucket[]; group: BucketGroup }) {
  const max = Math.max(...buckets.map((b) => Math.max(b.revenue ?? 0, b.totalCosts)), 1);
  return (
    <ChartShell
      buckets={buckets}
      group={group}
      max={max}
      yLabel={(v) => `$${Math.round(v / 10) * 10}`}
      ariaLabel="Revenue vs total cost"
    >
      {(f) => (
        <>
          {buckets.map((bucket, i) => {
            const barW = Math.min(f.step * 0.6, 48);
            const x = f.LEFT + i * f.step + (f.step - barW) / 2;
            const revenueH = bucket.revenue !== null ? (bucket.revenue / max) * f.plotH : 0;
            const costH = (bucket.totalCosts / max) * f.plotH;
            const dim = bucket.future ? 0.35 : 0.85;
            const label = bucketLabel(bucket, group);
            const costDetail = `labor ${fmtMoney(bucket.laborCost)} · fixed ${fmtMoney(bucket.fixedCosts)} · rent ${fmtMoney(bucket.rentCost)} · fees ${fmtMoney(bucket.feesCost)}`;
            return (
              <g key={bucket.start}>
                {bucket.revenue !== null && (
                  <rect
                    x={x}
                    y={f.TOP + f.plotH - revenueH}
                    width={barW}
                    height={revenueH}
                    fill={GOLD}
                    opacity={dim}
                  >
                    <title>
                      {`${label}${bucket.future ? ' (in progress)' : ''}: revenue ${fmtMoney(bucket.revenue)} · costs ${fmtMoney(bucket.totalCosts)}${bucket.profit !== null ? ` · profit ${fmtMoney(bucket.profit)}${bucket.profitMarginPct !== null ? ` (${bucket.profitMarginPct}%)` : ''}` : ''}`}
                    </title>
                  </rect>
                )}
                <rect
                  x={x + barW * 0.3}
                  y={f.TOP + f.plotH - costH}
                  width={barW * 0.4}
                  height={costH}
                  fill={CREME}
                  opacity={bucket.future ? 0.3 : 0.6}
                >
                  <title>{`${label}: total cost ${fmtMoney(bucket.totalCosts)} (${costDetail})`}</title>
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
 * break-even line). Gaps where a bucket has no revenue data. */
function UnitEconomicsChart({ buckets, group }: { buckets: BusinessBucket[]; group: BucketGroup }) {
  const values = buckets.flatMap((b) => [b.revenuePerOpenHour ?? 0, b.costPerOpenHour ?? 0]);
  const max = Math.max(...values, 1);
  const line = (pick: (b: BusinessBucket) => number | null, f: ChartFrame): string[] => {
    // Split into segments at nulls so missing buckets read as gaps, not zeros.
    const segments: string[][] = [[]];
    buckets.forEach((bucket, i) => {
      const value = pick(bucket);
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
      buckets={buckets}
      group={group}
      max={max}
      yLabel={(v) => `$${Math.round(v)}`}
      ariaLabel="Revenue and labor cost per open hour"
    >
      {(f) => (
        <>
          {line((b) => b.costPerOpenHour, f).map((points) => (
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
          {line((b) => b.revenuePerOpenHour, f).map((points) => (
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

/**
 * New members per bucket (gold). Cancellations used to sit beside these bars,
 * but Momence exposes no host endpoint for them — see lib/reports/activity.ts
 * — so the chart shows arrivals only rather than an always-empty half.
 */
function MembershipChart({ buckets, group }: { buckets: BusinessBucket[]; group: BucketGroup }) {
  const max = Math.max(...buckets.map((b) => b.newMembers ?? 0), 1);
  return (
    <ChartShell
      buckets={buckets}
      group={group}
      max={max}
      yLabel={(v) => String(Math.round(v))}
      ariaLabel="New members"
    >
      {(f) => (
        <>
          {buckets.map((bucket, i) => {
            const barW = Math.min(f.step * 0.6, 40);
            const x = f.LEFT + i * f.step + (f.step - barW) / 2;
            const newH = ((bucket.newMembers ?? 0) / max) * f.plotH;
            return (
              <rect
                key={bucket.start}
                x={x}
                y={f.TOP + f.plotH - newH}
                width={barW - 1}
                height={newH}
                fill={GOLD}
                opacity={bucket.future ? 0.35 : 0.85}
              >
                <title>{`${bucketLabel(bucket, group)}: ${bucket.newMembers ?? '—'} new${bucket.activeMembers !== null ? ` · ${bucket.activeMembers} active` : ''}`}</title>
              </rect>
            );
          })}
        </>
      )}
    </ChartShell>
  );
}

/** Attendance bars with a thin no-show overlay; occupancy in the tooltip. */
function AttendanceChart({ buckets, group }: { buckets: BusinessBucket[]; group: BucketGroup }) {
  const max = Math.max(...buckets.map((b) => b.attendance ?? 0), 1);
  return (
    <ChartShell
      buckets={buckets}
      group={group}
      max={max}
      yLabel={(v) => String(Math.round(v))}
      ariaLabel="Attendance"
    >
      {(f) => (
        <>
          {buckets.map((bucket, i) => {
            const barW = Math.min(f.step * 0.6, 48);
            const x = f.LEFT + i * f.step + (f.step - barW) / 2;
            const attendH = ((bucket.attendance ?? 0) / max) * f.plotH;
            const noShowH = ((bucket.noShows ?? 0) / max) * f.plotH;
            const dim = bucket.future ? 0.35 : 0.85;
            const label = bucketLabel(bucket, group);
            return (
              <g key={bucket.start}>
                {bucket.attendance !== null && (
                  <rect
                    x={x}
                    y={f.TOP + f.plotH - attendH}
                    width={barW}
                    height={attendH}
                    fill={GOLD}
                    opacity={dim}
                  >
                    <title>
                      {`${label}${bucket.future ? ' (in progress)' : ''}: ${fmtCount(bucket.attendance)} visits${bucket.occupancyPct !== null ? ` · ${bucket.occupancyPct}% occupancy` : ''}${bucket.noShows !== null ? ` · ${fmtCount(bucket.noShows)} no-shows` : ''}`}
                    </title>
                  </rect>
                )}
                {bucket.noShows !== null && bucket.noShows > 0 && (
                  <rect
                    x={x + barW * 0.35}
                    y={f.TOP + f.plotH - noShowH}
                    width={barW * 0.3}
                    height={noShowH}
                    fill={CREME}
                    opacity={bucket.future ? 0.3 : 0.6}
                  >
                    <title>{`${label}: ${fmtCount(bucket.noShows)} no-shows`}</title>
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

/** How often the freshness line re-renders, so "in 4m" actually counts down
 * on a dashboard left open. */
const CLOCK_TICK_MS = 30_000;

/**
 * Freshness line: when the Momence numbers were last pulled and when they
 * refresh next. Labor cost is called out as live because it is computed from
 * the shifts tables on every request — without that note, "synced 6h ago"
 * reads as if the whole page were 6h old.
 */
/**
 * Runs today's Momence pull on demand rather than waiting for the 6am ET cron.
 * The request holds open for up to ~45s of real syncing, so the button owns a
 * busy state instead of firing and forgetting.
 */
function SyncNowButton({ onSynced }: { onSynced: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; failed: boolean } | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/admin/business-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const body = (await res.json()) as BusinessSyncResponse & { error?: string };
      if (!res.ok) {
        setResult({ text: body.error ?? `Sync failed (${res.status})`, failed: true });
        return;
      }
      setResult({ text: body.message, failed: false });
      // The sync rewrote metric rows, so every cached range is stale, not just
      // the one on screen.
      invalidateJson('/api/admin/business-overview');
      await onSynced();
    } catch (err) {
      setResult({ text: err instanceof Error ? err.message : 'Sync failed', failed: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={buttonClass}
        disabled={busy}
        aria-busy={busy}
        onClick={() => void run()}
        title="Pull today's Momence data now instead of waiting for the daily sync"
      >
        {busy ? 'Syncing…' : 'Sync now'}
      </button>
      {busy && (
        <span className="font-mono text-xs text-white/40">
          Pulling from Momence — up to a minute.
        </span>
      )}
      {!busy && result && (
        <span
          className={`font-mono text-xs ${result.failed ? 'text-[var(--pyre-red)]' : 'text-white/50'}`}
          role="status"
        >
          {result.text}
        </span>
      )}
    </>
  );
}

export function SyncLine({
  sync,
  onSynced,
}: {
  sync: SyncStatus;
  onSynced: () => Promise<void> | void;
}) {
  // Re-render on a timer: the payload is fetched once on mount, so without
  // this the relative times freeze at whatever they were on first paint.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Both feeds in the tooltip — the headline shows only the stalest.
  const detail = [
    `Revenue: ${sync.reportsSyncedAt ? fmtDateTime(sync.reportsSyncedAt) : 'never synced'}`,
    `Attendance & members: ${
      sync.activitySyncedAt ? fmtDateTime(sync.activitySyncedAt) : 'never synced'
    }`,
  ].join('\n');

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-white/40">
      <span title={detail}>
        Momence data synced{' '}
        {sync.lastSyncedAt ? (
          <time
            dateTime={sync.lastSyncedAt}
            className={sync.stale ? 'text-[var(--pyre-gold)]' : 'text-white/70'}
          >
            {timeAgo(sync.lastSyncedAt, nowMs)}
          </time>
        ) : (
          <span className="text-[var(--pyre-gold)]">never</span>
        )}
      </span>
      <span aria-hidden="true">·</span>
      <span title={fmtDateTime(sync.nextSyncAt)}>
        next sync{' '}
        <time dateTime={sync.nextSyncAt} className="text-white/70">
          {timeAgo(sync.nextSyncAt, nowMs)}
        </time>
      </span>
      <span aria-hidden="true">·</span>
      <span>labor cost is live from the schedule</span>
      <SyncNowButton onSynced={onSynced} />
    </div>
  );
}

const GROUP_OPTIONS: Array<{ key: BucketGroup; label: string }> = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

export function BusinessOverview() {
  // ET calendar day, matching the API — a browser in another timezone must
  // not shift preset boundaries.
  const [today] = useState(() => utcToEastern(new Date().toISOString()).date);
  const [preset, setPreset] = useState<PresetKey>('last-12-weeks');
  const [group, setGroup] = useState<BucketGroup>('week');
  const [customStart, setCustomStart] = useState(() => addDays(today, -56));
  const [customEnd, setCustomEnd] = useState(today);

  const range =
    preset === 'custom' ? { start: customStart, end: customEnd } : presetRange(preset, today);
  const customValid =
    DATE_RE.test(range.start) && DATE_RE.test(range.end) && range.start <= range.end;

  // One cache entry per (range, grain), so switching back to a view you
  // already visited repaints from cache while it revalidates behind you.
  const url = customValid
    ? `/api/admin/business-overview?start=${range.start}&end=${range.end}&group=${group}`
    : null;
  const { data, error, loading, refreshing, reload } = useCachedJson<BusinessOverviewPayload>(url);

  const pickPreset = (key: PresetKey) => {
    setPreset(key);
    // Each preset opens at the grain it reads best at; the group buttons
    // still override afterwards.
    if (key !== 'custom') setGroup(presetRange(key, today).group);
  };

  const controls = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs uppercase tracking-wide text-white/40">Range</span>
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`${buttonClass} ${preset === p.key ? 'border-white/40 text-white' : ''}`}
            aria-pressed={preset === p.key}
            disabled={loading || refreshing}
            onClick={() => pickPreset(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs uppercase tracking-wide text-white/40">Group by</span>
        {GROUP_OPTIONS.map((g) => (
          <button
            key={g.key}
            type="button"
            className={`${buttonClass} ${group === g.key ? 'border-white/40 text-white' : ''}`}
            aria-pressed={group === g.key}
            disabled={loading || refreshing}
            onClick={() => setGroup(g.key)}
          >
            {g.label}
          </button>
        ))}
        {preset === 'custom' && (
          <>
            <input
              type="date"
              className={inputClass}
              value={customStart}
              max={customEnd}
              aria-label="Range start"
              onChange={(e) => setCustomStart(e.target.value)}
            />
            <span className="font-mono text-xs text-white/40">to</span>
            <input
              type="date"
              className={inputClass}
              value={customEnd}
              min={customStart}
              aria-label="Range end"
              onChange={(e) => setCustomEnd(e.target.value)}
            />
          </>
        )}
        {refreshing && <span className="font-mono text-xs text-white/40">Loading…</span>}
      </div>
    </div>
  );

  if (!customValid) {
    return (
      <div className="space-y-8">
        {controls}
        <p className="font-mono text-sm text-white/40">
          Pick a valid date range (start on or before end).
        </p>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="space-y-8">
        {controls}
        <p className="font-mono text-sm text-white/40">Loading…</p>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="space-y-8">
        {controls}
        <p className="rounded border border-[var(--pyre-red)]/40 bg-[var(--pyre-red)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-red)]">
          {error ?? 'Failed to load'}
        </p>
      </div>
    );
  }

  const s = data.summary.range;
  const prev = data.summary.previous;

  const { sync } = data;
  const neverSynced = sync.lastSyncedAt === null;

  return (
    <div className="space-y-8">
      {controls}

      <SyncLine sync={sync} onSynced={reload} />

      {(sync.stale || sync.missingReportTypes.length > 0) && (
        <div className="rounded border border-[var(--pyre-gold)]/40 bg-[var(--pyre-gold)]/10 px-3 py-2 font-mono text-xs text-[var(--pyre-gold)] space-y-1">
          {neverSynced && (
            <p>
              No Momence data yet — the daily sync hasn't run. Kick it off with the
              business-report-sync cron job or the backfill endpoint.
            </p>
          )}
          {sync.stale && !neverSynced && (
            <p>
              Momence data is over a day behind — the daily sync is failing or hasn't run. The
              numbers below may be stale.
            </p>
          )}
          {sync.missingReportTypes.length > 0 && (
            <p>
              No recent snapshot for: {sync.missingReportTypes.join(', ')} — those metrics show as
              missing. (Report type unavailable on the Momence plan, or its runs are failing.)
            </p>
          )}
        </div>
      )}

      {/* ---- KPI tiles (totals over the selected range, through today) ---- */}
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatTile
            label="Revenue"
            value={s.revenue != null ? fmtMoney(s.revenue) : '—'}
            sub={periodDelta(s.revenue, prev?.revenue ?? null) ?? fmtRange(s.start, s.end)}
          />
          <StatTile
            label="Revenue / open hour"
            value={s.revenuePerOpenHour != null ? fmtMoney(s.revenuePerOpenHour) : '—'}
            sub={
              s.costPerOpenHour != null
                ? `vs ${fmtMoney(s.costPerOpenHour)} labor break-even`
                : undefined
            }
          />
          <StatTile
            label="Labor % of revenue"
            value={s.laborPctOfRevenue != null ? `${s.laborPctOfRevenue}%` : '—'}
            sub={`${fmtMoney(s.laborCost)} labor cost`}
          />
          <StatTile
            label="Active members"
            value={s.activeMembers != null ? fmtCount(s.activeMembers) : '—'}
            sub={periodDelta(s.activeMembers, prev?.activeMembers ?? null) ?? undefined}
          />
          <StatTile
            label="Visits"
            value={s.attendance != null ? fmtCount(s.attendance) : '—'}
            sub={s.occupancyPct != null ? `${s.occupancyPct}% occupancy` : undefined}
          />
        </div>
        {/* Profit row: revenue minus labor plus the operating costs managed
            at the bottom of this page. */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatTile
            label="Profit"
            value={s.profit != null ? fmtMoney(s.profit) : '—'}
            sub={
              periodDelta(s.profit, prev?.profit ?? null) ??
              (s.profitMarginPct != null ? `${s.profitMarginPct}% margin` : undefined)
            }
            bad={s.profit != null && s.profit < 0}
          />
          <StatTile
            label="Profit margin"
            value={s.profitMarginPct != null ? `${s.profitMarginPct}%` : '—'}
            sub={s.revenue != null ? `on ${fmtMoney(s.revenue)} revenue` : undefined}
            bad={s.profitMarginPct != null && s.profitMarginPct < 0}
          />
          <StatTile
            label="Total costs"
            value={fmtMoney(s.totalCosts)}
            sub={
              periodDelta(s.totalCosts, prev?.totalCosts ?? null) ??
              `incl. ${fmtMoney(s.laborCost)} labor`
            }
          />
          <StatTile
            label="Overhead"
            value={fmtMoney(s.fixedCosts + s.rentCost + s.feesCost)}
            sub={`rent ${fmtMoney(s.rentCost)} · fixed ${fmtMoney(s.fixedCosts)} · fees ${fmtMoney(s.feesCost)}`}
          />
        </div>
        <p className="font-mono text-xs text-white/40">
          Totals cover {fmtRange(s.start, s.end)}
          {prev ? ` · prior period ${fmtRange(prev.start, prev.end)}` : ''}
        </p>
      </div>

      {/* ---- Revenue vs total cost (profit) ---- */}
      <section className="space-y-2">
        <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-white/40">
          Revenue vs total cost
        </h2>
        <Legend
          items={[
            { color: GOLD, label: 'revenue' },
            { color: CREME, label: 'total cost (labor + operating)' },
          ]}
        />
        <RevenueVsCostChart buckets={data.buckets} group={data.group} />
        <p className="font-mono text-xs text-white/40">
          The gap between gold and creme is the profit. Operating costs come from the list at the
          bottom of this page; labor comes from the schedule.
        </p>
      </section>

      {/* ---- Revenue vs labor ---- */}
      <section className="space-y-2">
        <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-white/40">
          Revenue vs labor cost
        </h2>
        <Legend
          items={[
            { color: GOLD, label: 'revenue' },
            { color: CREME, label: 'labor cost' },
          ]}
        />
        <RevenueVsLaborChart buckets={data.buckets} group={data.group} />
        <p className="font-mono text-xs text-white/40">
          Dimmed bars are still in progress — partial numbers. Missing revenue bars mean no Momence
          data covers that period yet.
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
        <UnitEconomicsChart buckets={data.buckets} group={data.group} />
        <p className="font-mono text-xs text-white/40">
          Gold above the dashed line means the customer-facing hours pay for the labor staffing
          them.
        </p>
      </section>

      {/* ---- Memberships ---- */}
      <section className="space-y-2">
        <h2 className="font-mono text-xs font-bold uppercase tracking-wide text-white/40">
          Memberships: new members
        </h2>
        <Legend items={[{ color: GOLD, label: 'new members' }]} />
        <MembershipChart buckets={data.buckets} group={data.group} />
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
        <AttendanceChart buckets={data.buckets} group={data.group} />
      </section>

      {/* ---- Operating costs manager ---- */}
      <BusinessCosts today={today} onChanged={() => void reload()} />
    </div>
  );
}
