// Rejected units per week for one item (the Rejects tab): one thin column
// per studio week, the newest on the right, so a run of bad deliveries
// stands out. A single series, so no legend box: the section title names it.
//
// Columns are capped at 24px wide with a 4px rounded top and a square
// baseline; the tallest week carries its value at the cap, the rest are read
// from the axis or the hover readout (delivered, rejected, reject rate,
// value). The week-by-week table on the Rejects tab is the no-hover (and
// keyboard) path to every number.
// One axis only: the reject rate lives in the readout and the table, never
// on a second scale.
//
// Series colour: the lightened Pyre blue the other inventory chart uses,
// validated for 3:1 contrast on the dark surface.

import { useEffect, useMemo, useRef, useState } from 'react';
import { rejectRate } from '@/lib/inventory/rejects';
import { formatCents, formatQuantity, pluralUnit } from '@/lib/inventory/rules';
import type { RejectWeek } from '@/lib/inventory/types';

const SERIES = '#5590c8';
const GRID = 'rgba(255, 255, 255, 0.08)';
const TEXT_MUTED = 'rgba(245, 241, 233, 0.5)';
const TEXT_STRONG = 'rgba(245, 241, 233, 0.9)';

const H = 200;
const PAD = { top: 20, right: 8, bottom: 24, left: 32 };
const MAX_BAR = 24;

const weekLabel = (week: string) =>
  new Date(`${week}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

/** Whole-number steps (rejects are counted in whole units): 0, step, 2·step, … */
function ticks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw);
  const out: number[] = [];
  for (let v = 0; v < max + step; v += step) out.push(v);
  return out;
}

export function InventoryRejectChart({ weeks, unit }: { weeks: RejectWeek[]; unit: string }) {
  const figureRef = useRef<HTMLElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [W, setW] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const figure = figureRef.current;
    if (!figure) return;
    const measure = () => setW(Math.max(280, Math.round(figure.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(figure);
    return () => observer.disconnect();
  }, []);

  const g = useMemo(() => {
    const max = Math.max(...weeks.map((w) => w.rejected), 0);
    const yTicks = ticks(max);
    const yMax = yTicks[yTicks.length - 1] || 1;
    const plotW = W - PAD.left - PAD.right;
    const slot = plotW / Math.max(1, weeks.length);
    const bar = Math.min(MAX_BAR, Math.max(4, slot * 0.6));
    const y = (v: number) => PAD.top + (1 - v / yMax) * (H - PAD.top - PAD.bottom);
    const peak = weeks.reduce(
      (best, w, i) => (w.rejected > (weeks[best]?.rejected ?? 0) ? i : best),
      0
    );
    // A date under every Nth column, so labels never collide.
    const every = Math.max(1, Math.ceil(weeks.length / Math.floor(plotW / 56)));
    return { yTicks, y, slot, bar, peak, every, baseline: y(0) };
  }, [weeks, W]);

  /** A column with a 4px rounded top and a square foot on the baseline. */
  const columnPath = (x: number, top: number, width: number) => {
    const r = Math.min(4, width / 2, g.baseline - top);
    return `M${x},${g.baseline} V${top + r} Q${x},${top} ${x + r},${top} H${x + width - r} Q${x + width},${top} ${x + width},${top + r} V${g.baseline} Z`;
  };

  // The whole week's slot is the hit target, not just the column: the
  // pointer only has to be over the week.
  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || weeks.length === 0) return;
    const i = Math.floor((event.clientX - rect.left - PAD.left) / g.slot);
    setHover(i >= 0 && i < weeks.length ? i : null);
  };

  const active = hover == null ? null : weeks[hover];

  return (
    <figure ref={figureRef} className="relative m-0">
      <svg
        ref={svgRef}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
        width={W}
        height={H}
        className="block select-none"
        role="img"
        aria-label={`Rejected ${pluralUnit(2, unit)} per week`}
      >
        {g.yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={g.y(v)} y2={g.y(v)} stroke={GRID} />
            <text
              x={PAD.left - 6}
              y={g.y(v)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="10"
              fill={TEXT_MUTED}
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatQuantity(v)}
            </text>
          </g>
        ))}
        {weeks.map((w, i) => {
          const cx = PAD.left + g.slot * i + g.slot / 2;
          const x = cx - g.bar / 2;
          const top = g.y(w.rejected);
          return (
            <g key={w.week}>
              {w.rejected > 0 && (
                <path
                  d={columnPath(x, top, g.bar)}
                  fill={SERIES}
                  opacity={hover == null || hover === i ? 1 : 0.55}
                />
              )}
              {i === g.peak && w.rejected > 0 && (
                <text x={cx} y={top - 5} textAnchor="middle" fontSize="10" fill={TEXT_STRONG}>
                  {formatQuantity(w.rejected)}
                </text>
              )}
              {i % g.every === (weeks.length - 1) % g.every && (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize="10" fill={TEXT_MUTED}>
                  {weekLabel(w.week)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {active && hover != null && (
        <div
          className="pointer-events-none absolute top-0 rounded border border-white/15 bg-[var(--pyre-black)] px-2.5 py-1.5 text-xs shadow-lg"
          style={{
            left: `${Math.min(65, Math.max(0, ((PAD.left + g.slot * hover) / W) * 100 - 10))}%`,
          }}
        >
          <p className="font-primary-semibold text-sm text-[var(--pyre-creme)]">
            {formatQuantity(active.rejected)} rejected
          </p>
          <p className="text-white/50">
            of {formatQuantity(active.delivered)} delivered
            {active.delivered > 0 && ` · ${rejectRate(active.rejected, active.delivered)}%`}
          </p>
          {active.rejectedCents > 0 && (
            <p className="text-white/50">{formatCents(active.rejectedCents)}</p>
          )}
          <p className="text-white/40">Week of {weekLabel(active.week)}</p>
        </div>
      )}
    </figure>
  );
}
