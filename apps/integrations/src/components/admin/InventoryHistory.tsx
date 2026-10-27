// The Analytics tab of an inventory item's details dialog: how fast it's used,
// its stock over time, and every change to it with who made it — counts,
// prices, links, schedules. Reads /api/admin/inventory-history, and reloads
// whenever the item changes so a save made in the Details tab shows up.

import { type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useCachedJson } from '@/lib/client/cachedJson';
import { etStamp, etStampWithYear } from '@/lib/client/format';
import { changedFields, formatFieldValue, stockDelta } from '@/lib/inventory/changes';
import {
  formatDaysLeft,
  formatPerWeek,
  formatQuantity,
  USAGE_WINDOW_DAYS,
  usageOf,
} from '@/lib/inventory/rules';
import {
  INVENTORY_HISTORY_API,
  type InventoryHistoryEntry,
  type InventoryHistoryResponse,
  type InventoryRow,
} from '@/lib/inventory/types';
import { type PeopleNames, personName } from '@/lib/sops/names';
import { ErrorBanner } from './ErrorBanner';
import { Chip } from './incidentUi';

const DAY_MS = 86_400_000;
const RANGES = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
] as const;

export function InventoryHistory({ item, now }: { item: InventoryRow; now: Date }) {
  const { data, error, loading, reload } = useCachedJson<InventoryHistoryResponse>(
    `${INVENTORY_HISTORY_API}?id=${item.id}`
  );
  // Refetch after each save to the item (the first run is the hook's own load).
  const seen = useRef(item.updated_at);
  useEffect(() => {
    if (seen.current === item.updated_at) return;
    seen.current = item.updated_at;
    void reload();
  }, [item.updated_at, reload]);

  if (loading) return <p className="font-mono text-xs text-white/40">Loading…</p>;
  if (error && !data) return <ErrorBanner>Couldn't load the history: {error}</ErrorBanner>;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <UsageSummary item={item} entries={data.entries} now={now} />
      {data.entries.length > 0 && (
        <StockChart item={item} entries={data.entries} people={data.people} now={now} />
      )}
      <ChangeLog entries={data.entries} people={data.people} truncated={data.truncated} />
    </div>
  );
}

function UsageSummary({
  item,
  entries,
  now,
}: {
  item: InventoryRow;
  entries: readonly InventoryHistoryEntry[];
  now: Date;
}) {
  const usage = usageOf(
    entries.map((e) => ({ in_stock: e.in_stock, at: e.changed_at })),
    now
  );
  if (!usage) {
    return (
      <p className="rounded border border-white/10 bg-white/[0.03] p-3 text-sm text-white/60">
        Not enough counts yet to work out how fast this goes. It needs counts at least a day apart
        in the last {USAGE_WINDOW_DAYS} days.
      </p>
    );
  }
  const left = usage.perDay > 0 ? item.in_stock / usage.perDay : null;
  const tiles = [
    { label: 'Uses about', value: formatPerWeek(usage.perDay) },
    { label: 'Runs out in', value: left == null ? 'Not using any' : `~${formatDaysLeft(left)}` },
    { label: 'Restocked', value: `${usage.restocks} time${usage.restocks === 1 ? '' : 's'}` },
  ];
  return (
    <div>
      <dl className="grid grid-cols-3 gap-2">
        {tiles.map((t) => (
          <div key={t.label} className="rounded border border-white/10 bg-white/[0.03] p-3">
            <dt className="font-mono text-[10px] uppercase tracking-wide text-white/40">
              {t.label}
            </dt>
            <dd className="mt-1 text-base font-semibold tabular-nums text-[var(--pyre-creme)]">
              {t.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-1.5 text-xs text-white/40">
        Over the last {USAGE_WINDOW_DAYS} days: {formatQuantity(Math.round(usage.used * 10) / 10)}{' '}
        used across {Math.round(usage.days)} days of counts. Stretches with a restock are left out.
      </p>
    </div>
  );
}

const CHART_HEIGHT = 160;
const PAD = { top: 12, right: 12, bottom: 22, left: 36 };

/** The width of an element, kept current as it resizes. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Three or four round numbers from 0 to at least `max`. */
function ticks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 3;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? rough;
  const out: number[] = [];
  for (let v = 0; v < max + step; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

/**
 * Stock on hand over time, as steps: the number holds until the next look
 * at the shelf. The re-order level is a dashed line. Hovering shows the
 * nearest count; the change log below is the same data as text.
 */
function StockChart({
  item,
  entries,
  people,
  now,
}: {
  item: InventoryRow;
  entries: readonly InventoryHistoryEntry[];
  people: PeopleNames;
  now: Date;
}) {
  const [range, setRange] = useState<number>(90);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const end = now.getTime();
  const start = end - range * DAY_MS;
  const points = useMemo(() => {
    const asc = [...entries].sort((a, b) => Date.parse(a.changed_at) - Date.parse(b.changed_at));
    const inRange = asc.filter((e) => Date.parse(e.changed_at) >= start);
    // Where the line starts: the last look before the range, carried to its edge.
    const before = asc.filter((e) => Date.parse(e.changed_at) < start).at(-1);
    return { inRange, startValue: before?.in_stock ?? null };
  }, [entries, start]);

  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = CHART_HEIGHT - PAD.top - PAD.bottom;
  const firstAt = points.inRange[0] ? Date.parse(points.inRange[0].changed_at) : end;
  // With no look before the range, the line starts at the first count.
  const from = points.startValue == null ? Math.min(firstAt, end - DAY_MS) : start;
  const values = [
    ...points.inRange.map((p) => p.in_stock),
    points.startValue ?? 0,
    item.reorder_at ?? 0,
  ];
  const yTicks = ticks(Math.max(...values));
  const yMax = yTicks[yTicks.length - 1] || 1;
  const x = (t: number) => PAD.left + ((t - from) / Math.max(1, end - from)) * plotW;
  const y = (n: number) => PAD.top + plotH - (n / yMax) * plotH;

  let path = '';
  if (points.startValue != null) path = `M${x(from)},${y(points.startValue)}`;
  for (const p of points.inRange) {
    const px = x(Date.parse(p.changed_at));
    const py = y(p.in_stock);
    path += path ? `H${px}V${py}` : `M${px},${py}`;
  }
  if (path) path += `H${x(end)}`;

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (points.inRange.length === 0) return;
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    points.inRange.forEach((p, i) => {
      const d = Math.abs(x(Date.parse(p.changed_at)) - px);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    setHover(best);
  };
  const hovered = hover == null ? null : points.inRange[hover];
  const axisDates = [from, (from + end) / 2, end];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-mono text-[10px] uppercase tracking-wide text-white/50">
          In stock over time
        </h3>
        <div className="flex gap-1.5">
          {RANGES.map((r) => (
            <Chip
              key={r.days}
              label={r.label}
              selected={range === r.days}
              onClick={() => {
                setRange(r.days);
                setHover(null);
              }}
            />
          ))}
        </div>
      </div>
      <div ref={ref} className="relative">
        {width > 0 && (
          <svg
            width={width}
            height={CHART_HEIGHT}
            role="img"
            aria-label={`${item.name} in stock over the last ${range} days`}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            className="block touch-none"
          >
            {yTicks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={PAD.left + plotW}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="currentColor"
                  className="text-white/10"
                />
                <text
                  x={PAD.left - 6}
                  y={y(t)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-white/40 font-mono text-[10px]"
                >
                  {formatQuantity(t)}
                </text>
              </g>
            ))}
            {axisDates.map((t, i) => (
              <text
                key={t}
                x={x(t)}
                y={CHART_HEIGHT - 6}
                textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
                className="fill-white/40 font-mono text-[10px]"
              >
                {i === 2 ? 'Now' : shortDate(t)}
              </text>
            ))}
            {item.reorder_at != null && (
              <g>
                <line
                  x1={PAD.left}
                  x2={PAD.left + plotW}
                  y1={y(item.reorder_at)}
                  y2={y(item.reorder_at)}
                  stroke="var(--pyre-red)"
                  strokeDasharray="4 4"
                  strokeOpacity={0.7}
                />
                <text
                  x={PAD.left + plotW}
                  y={y(item.reorder_at) - 4}
                  textAnchor="end"
                  className="fill-white/50 font-mono text-[10px]"
                >
                  Re-order at {formatQuantity(item.reorder_at)}
                </text>
              </g>
            )}
            {path && (
              <path
                d={path}
                fill="none"
                stroke="var(--pyre-gold)"
                strokeWidth={2}
                strokeLinejoin="round"
              />
            )}
            {points.inRange.map((p, i) => (
              <circle
                key={p.id}
                cx={x(Date.parse(p.changed_at))}
                cy={y(p.in_stock)}
                r={hover === i ? 5 : 3}
                fill="var(--pyre-gold)"
                stroke="var(--pyre-black)"
                strokeWidth={2}
              />
            ))}
            {hovered && (
              <line
                x1={x(Date.parse(hovered.changed_at))}
                x2={x(Date.parse(hovered.changed_at))}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke="currentColor"
                className="pointer-events-none text-white/30"
              />
            )}
          </svg>
        )}
        {hovered && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded border border-white/15 bg-[var(--pyre-black)] px-2 py-1 text-xs shadow-lg"
            style={{
              left: Math.min(
                Math.max(x(Date.parse(hovered.changed_at)), 70),
                Math.max(70, width - 70)
              ),
            }}
          >
            <span className="font-semibold tabular-nums text-[var(--pyre-creme)]">
              {formatQuantity(hovered.in_stock)} in stock
            </span>
            <span className="block text-white/50">
              {etStamp(hovered.changed_at)} · {personName(hovered.changed_by, people)}
            </span>
          </div>
        )}
        {points.inRange.length === 0 && (
          <p className="absolute inset-0 flex items-center justify-center text-xs text-white/40">
            No counts in the last {range} days
          </p>
        )}
      </div>
    </div>
  );
}

function shortDate(t: number): string {
  return new Date(t).toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
  });
}

/** Every change, newest first: when, who, and each field before and after. */
function ChangeLog({
  entries,
  people,
  truncated,
}: {
  entries: readonly InventoryHistoryEntry[];
  people: PeopleNames;
  truncated: boolean;
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-white/50">No changes recorded yet.</p>;
  }
  return (
    <div>
      <h3 className="mb-2 font-mono text-[10px] uppercase tracking-wide text-white/50">Changes</h3>
      <ol className="divide-y divide-white/5 rounded border border-white/10">
        {entries.map((entry) => (
          <li key={entry.id} className="px-3 py-2">
            <p className="text-xs text-white/50">
              <time dateTime={entry.changed_at} title={etStampWithYear(entry.changed_at)}>
                {etStamp(entry.changed_at)}
              </time>{' '}
              · {personName(entry.changed_by, people)}
            </p>
            <EntryBody entry={entry} />
          </li>
        ))}
      </ol>
      {truncated && (
        <p className="mt-1.5 text-xs text-white/40">Showing the most recent {entries.length}.</p>
      )}
    </div>
  );
}

function EntryBody({ entry }: { entry: InventoryHistoryEntry }) {
  const fields = changedFields(entry);
  if (entry.action === 'add') {
    return (
      <p className="text-sm text-[var(--pyre-creme)]">
        Added the item
        {entry.in_stock > 0 && ` with ${formatQuantity(entry.in_stock)} in stock`}
      </p>
    );
  }
  if (fields.length === 0) {
    return (
      <p className="text-sm text-[var(--pyre-creme)]">
        Counted {formatQuantity(entry.in_stock)}, no change
      </p>
    );
  }
  return (
    <ul className="space-y-0.5 text-sm text-[var(--pyre-creme)]">
      {fields.map(({ key, label, change }) => {
        const before = formatFieldValue(key, change.from);
        const after = formatFieldValue(key, change.to);
        const delta = key === 'in_stock' ? stockDelta(change) : null;
        return (
          <li key={key} className="break-words">
            <span className="text-white/50">{label}:</span>{' '}
            {before == null ? (
              <span className="text-white/30">none</span>
            ) : (
              <span className="text-white/60">{before}</span>
            )}{' '}
            <span className="text-white/40">→</span>{' '}
            {after == null ? <span className="text-white/30">none</span> : after}
            {delta && <span className="ml-1.5 font-mono text-xs text-white/50">({delta})</span>}
          </li>
        );
      })}
      {entry.action === 'import' && (
        <li className="text-xs text-white/40">From the first inventory's stock records</li>
      )}
    </ul>
  );
}
