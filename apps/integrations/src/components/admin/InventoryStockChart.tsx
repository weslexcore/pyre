// Stock-over-time chart for one inventory item (the item page): the total on
// hand across every spot, drawn as a step line — stock changes in jumps, not
// slopes — with a light wash beneath, the re-order level as a dashed
// reference, and a marker on each delivery (R) and count adjustment (C). The
// letter carries the marker's meaning; the colour never does alone.
//
// A crosshair snaps to the nearest change and a tooltip reads it out; the
// item page's change list below the chart is the no-hover path to every
// number. One series, so no legend box: the section title names it.
//
// The series colour is the lightened Pyre blue the water log uses, validated
// for 3:1 contrast on the dark surface (dataviz palette validator).

import { useEffect, useMemo, useRef, useState } from 'react';
import { etStamp } from '@/lib/client/format';
import { formatQuantity, pluralUnit } from '@/lib/inventory/rules';
import { MOVEMENT_LABELS, type StockPoint } from '@/lib/inventory/types';

const SERIES = '#5590c8';
const SURFACE = '#23221c'; // --pyre-black: the ring that keeps markers legible
const GRID = 'rgba(255, 255, 255, 0.08)';
const REFERENCE = 'rgba(255, 255, 255, 0.45)';
const TEXT_MUTED = 'rgba(245, 241, 233, 0.5)';

// Drawn at the width it is shown at (measured), so text stays legible on a
// phone instead of shrinking with a scaled viewBox.
const DEFAULT_W = 640;
const H = 240;
const PAD = { top: 22, right: 16, bottom: 26, left: 40 };

const GLYPH: Partial<Record<StockPoint['type'], string>> = { receive: 'R', count_adjust: 'C' };

/** Clean tick values from 0 to at least `max`: 0, step, 2·step, … */
function ticks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v * 100) / 100);
  if (out[out.length - 1] < max) out.push(Math.round((out[out.length - 1] + step) * 100) / 100);
  return out;
}

export function InventoryStockChart({
  points,
  unit,
  reorderLevel,
  now,
}: {
  points: StockPoint[];
  unit: string;
  reorderLevel: number | null;
  /** The right edge of the window (ISO) — the line runs flat to it. */
  now: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const figureRef = useRef<HTMLElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [W, setW] = useState(DEFAULT_W);

  useEffect(() => {
    const figure = figureRef.current;
    if (!figure) return;
    const measure = () => setW(Math.max(280, Math.round(figure.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(figure);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(() => {
    const t0 = Date.parse(points[0]?.t ?? now);
    const t1 = Math.max(Date.parse(now), t0 + 1);
    const maxQty = Math.max(1, reorderLevel ?? 0, ...points.map((p) => p.qty));
    const yTicks = ticks(maxQty);
    const yMax = yTicks[yTicks.length - 1];
    // Stock can't go below zero in the ledger; the floor is just a guard.
    const yMin = Math.min(0, ...points.map((p) => p.qty));
    const x = (t: string) =>
      PAD.left + ((Date.parse(t) - t0) / (t1 - t0)) * (W - PAD.left - PAD.right);
    const y = (q: number) =>
      PAD.top + (1 - (q - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);

    // Step path: hold each level until the next change, then jump.
    let d = '';
    points.forEach((p, i) => {
      const px = x(p.t);
      const py = y(p.qty);
      if (i === 0) d = `M${px},${py}`;
      else d += ` H${px} V${py}`;
    });
    const endX = x(now);
    if (points.length > 0) d += ` H${endX}`;
    const area = points.length > 0 ? `${d} V${y(yMin)} H${x(points[0].t)} Z` : '';

    // Five date ticks across the window.
    const fractions = W < 480 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
    const dateTicks = fractions.map((f) => {
      const t = new Date(t0 + f * (t1 - t0)).toISOString();
      // The end ticks align inward so their labels never run off the chart.
      const anchor: 'start' | 'middle' | 'end' = f === 0 ? 'start' : f === 1 ? 'end' : 'middle';
      return {
        x: x(t),
        anchor,
        label: new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      };
    });

    return { x, y, d, area, yTicks, dateTicks };
  }, [points, reorderLevel, now, W]);

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || points.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    points.forEach((p, i) => {
      const dist = Math.abs(geometry.x(p.t) - px);
      if (dist < bestDist) {
        best = i;
        bestDist = dist;
      }
    });
    setHover(best);
  };

  const active = hover == null ? null : points[hover];
  const plotBottom = H - PAD.bottom;

  return (
    <figure ref={figureRef} className="relative m-0">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="block touch-pan-y select-none"
        role="img"
        aria-label={`Stock on hand over time, in ${pluralUnit(2, unit)}`}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {geometry.yTicks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={geometry.y(v)}
              y2={geometry.y(v)}
              stroke={GRID}
            />
            <text
              x={PAD.left - 6}
              y={geometry.y(v)}
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
        {geometry.dateTicks.map((tick) => (
          <text
            key={tick.x}
            x={tick.x}
            y={H - 8}
            textAnchor={tick.anchor}
            fontSize="10"
            fill={TEXT_MUTED}
          >
            {tick.label}
          </text>
        ))}

        {reorderLevel != null && (
          <g>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={geometry.y(reorderLevel)}
              y2={geometry.y(reorderLevel)}
              stroke={REFERENCE}
              strokeDasharray="4 4"
            />
            <text
              x={W - PAD.right}
              y={geometry.y(reorderLevel) - 5}
              textAnchor="end"
              fontSize="10"
              fill={TEXT_MUTED}
            >
              Re-order at {formatQuantity(reorderLevel)}
            </text>
          </g>
        )}

        <path d={geometry.area} fill={SERIES} fillOpacity={0.1} />
        <path
          d={geometry.d}
          fill="none"
          stroke={SERIES}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {points.map((p, i) => {
          const glyph = GLYPH[p.type];
          if (!glyph) return null;
          const cx = geometry.x(p.t);
          const cy = geometry.y(p.qty);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: points are a fixed time-ordered series with no ids; two changes can share a timestamp
            <g key={`${p.t}-${i}`}>
              <circle cx={cx} cy={cy} r={4} fill={SERIES} stroke={SURFACE} strokeWidth={2} />
              <text
                x={cx}
                y={cy - 9}
                textAnchor="middle"
                fontSize="9"
                fontWeight={700}
                fill={TEXT_MUTED}
              >
                {glyph}
              </text>
            </g>
          );
        })}

        {active && (
          <g pointerEvents="none">
            <line
              x1={geometry.x(active.t)}
              x2={geometry.x(active.t)}
              y1={PAD.top}
              y2={plotBottom}
              stroke="rgba(255,255,255,0.3)"
            />
            <circle
              cx={geometry.x(active.t)}
              cy={geometry.y(active.qty)}
              r={5}
              fill={SERIES}
              stroke={SURFACE}
              strokeWidth={2}
            />
          </g>
        )}
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute top-0 rounded border border-white/15 bg-[var(--pyre-black)] px-2.5 py-1.5 text-xs shadow-lg"
          style={{
            left: `${Math.min(70, Math.max(0, (geometry.x(active.t) / W) * 100 - 10))}%`,
          }}
        >
          <p className="font-primary-semibold text-sm text-[var(--pyre-creme)]">
            {formatQuantity(active.qty)} {pluralUnit(active.qty, unit)}
          </p>
          <p className="text-white/50">
            {hover === 0
              ? 'Start of the window'
              : `${MOVEMENT_LABELS[active.type]} ${active.change > 0 ? '+' : '−'}${formatQuantity(Math.abs(active.change))}`}
          </p>
          <p className="text-white/40">{etStamp(active.t)}</p>
        </div>
      )}
      <figcaption className="mt-1 flex flex-wrap gap-x-4 text-[11px] text-white/45">
        <span>R = delivery received</span>
        <span>C = count adjustment</span>
      </figcaption>
    </figure>
  );
}
