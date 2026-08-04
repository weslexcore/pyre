// Readings-over-time chart for /admin/water: four small multiples (TA, pH,
// chlorine, salt) sharing one time axis — the parameters' scales differ by
// orders of magnitude, so they never share a y-axis. Each panel shades its
// target range; shock and drain/refill entries render as labeled vertical
// markers (S / R — the letter carries identity, not the color). A crosshair
// snaps to the nearest logged entry and a tooltip reads out every value; the
// log below the chart remains the no-hover way to every number.
//
// Series colors are lightness-adjusted steps of the Pyre blue/gold hues,
// validated for CVD separation and 3:1 contrast on the dark surface
// (dataviz palette validator — see the PR notes).
import { useMemo, useRef, useState } from 'react';
import type { WaterTestRow } from '@/lib/db';
import { TARGETS, type Tub } from '@/lib/water/charts';

const SERIES_COLOR: Record<Tub, string> = { left: '#5590c8', right: '#b58d35' };
const TUB_LABEL: Record<Tub, string> = { left: 'Left', right: 'Right' };
const BAND_FILL = 'rgba(131, 151, 112, 0.14)'; // --pyre-sage wash
const GRID = 'rgba(255, 255, 255, 0.08)';
const SURFACE = '#23221c'; // --pyre-black; ring color so dots stay legible

const PANELS = [
  { key: 'ta', label: 'Total Alkalinity (ppm)', column: 'ta_ppm' },
  { key: 'ph', label: 'pH', column: 'ph' },
  { key: 'chlorine', label: 'Chlorine (ppm)', column: 'chlorine_ppm' },
  { key: 'salt', label: 'Salt (ppm)', column: 'salt_ppm' },
] as const;

// Geometry (viewBox units; the SVG scales to the container width)
const W = 640;
const PANEL_H = 84;
const PANEL_GAP = 30; // room for each panel's title
const TOP = 18; // room for event glyphs
const LEFT = 46;
const RIGHT = 12;
const AXIS_H = 24;
const H = TOP + PANELS.length * (PANEL_GAP + PANEL_H) + AXIS_H;

const panelTop = (i: number) => TOP + i * (PANEL_GAP + PANEL_H) + PANEL_GAP;

function niceTicks(lo: number, hi: number): number[] {
  const span = hi - lo;
  if (span <= 0) return [lo];
  const step = 10 ** Math.floor(Math.log10(span / 2));
  const candidates = [step, step * 2, step * 5, step * 10];
  const pick = candidates.find((s) => span / s <= 3) ?? step * 10;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / pick) * pick; v <= hi + 1e-9; v += pick) {
    ticks.push(Number(v.toFixed(6)));
  }
  return ticks;
}

const fmtValue = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString('en-US') : String(v));

const fmtDay = (t: number) =>
  new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const fmtFull = (t: number) =>
  new Date(t).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export function WaterTrends({
  records,
  visibleTubs,
}: {
  records: WaterTestRow[];
  visibleTubs: Tub[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  // Oldest-first, stamped with a parsed timestamp.
  const rows = useMemo(
    () =>
      records
        .map((r) => ({ ...r, t: Date.parse(r.created_at) }))
        .filter((r) => Number.isFinite(r.t))
        .sort((a, b) => a.t - b.t),
    [records]
  );

  const events = rows.filter((r) => r.entry_type !== 'test');
  const pointCount = rows.reduce((n, r) => n + PANELS.filter((p) => r[p.column] != null).length, 0);

  const hovered = hoverId ? (rows.find((r) => r.id === hoverId) ?? null) : null;

  if (pointCount < 2) {
    return <p className="text-sm text-white/40">Not enough entries in this range to chart yet.</p>;
  }

  const tMin = rows[0].t;
  const tMax = rows[rows.length - 1].t;
  const tPad = Math.max((tMax - tMin) * 0.03, 1);
  const x = (t: number) =>
    LEFT + ((t - (tMin - tPad)) / (tMax + tPad - (tMin - tPad))) * (W - LEFT - RIGHT);

  // Per-panel y-scale over data ∪ target band, padded.
  const panelScales = PANELS.map((panel) => {
    const values = rows
      .filter((r) => visibleTubs.includes(r.tub) && r[panel.column] != null)
      .map((r) => r[panel.column] as number);
    const [targetLo, targetHi] = TARGETS[panel.key];
    const lo = Math.min(targetLo, ...values);
    const hi = Math.max(targetHi, ...values);
    const pad = Math.max((hi - lo) * 0.12, 0.1);
    return { lo: lo - pad, hi: hi + pad };
  });

  const y = (panelIndex: number, v: number) => {
    const { lo, hi } = panelScales[panelIndex];
    const top = panelTop(panelIndex);
    return top + PANEL_H - ((v - lo) / (hi - lo)) * PANEL_H;
  };

  // X-axis day ticks: first, last, and two in between.
  const dayTicks = tMax > tMin ? [0, 1, 2, 3].map((i) => tMin + ((tMax - tMin) * i) / 3) : [tMin];

  const snapToNearest = (clientX: number) => {
    const svg = containerRef.current?.querySelector('svg');
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const vx = ((clientX - rect.left) / rect.width) * W;
    let best: (typeof rows)[number] | null = null;
    for (const r of rows) {
      if (!visibleTubs.includes(r.tub)) continue;
      if (!best || Math.abs(x(r.t) - vx) < Math.abs(x(best.t) - vx)) best = r;
    }
    setHoverId(best?.id ?? null);
  };

  const hoverX = hovered ? x(hovered.t) : null;

  return (
    <div ref={containerRef} className="relative">
      {visibleTubs.length > 1 && (
        <div className="mb-2 flex gap-4">
          {visibleTubs.map((t) => (
            <span key={t} className="flex items-center gap-1.5 font-mono text-xs text-white/60">
              <span
                className="inline-block h-0.5 w-4 rounded"
                style={{ backgroundColor: SERIES_COLOR[t] }}
              />
              {TUB_LABEL[t]}
            </span>
          ))}
        </div>
      )}

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label="Water readings over time; every value is listed in the log below"
        onPointerMove={(e) => snapToNearest(e.clientX)}
        onPointerDown={(e) => snapToNearest(e.clientX)}
        onPointerLeave={() => setHoverId(null)}
      >
        {/* Event markers span all panels; glyph at top carries identity */}
        {events.map((event) => (
          <g key={`event-${event.id}`}>
            <line
              x1={x(event.t)}
              y1={TOP}
              x2={x(event.t)}
              y2={H - AXIS_H}
              stroke="rgba(255,255,255,0.22)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <text
              x={x(event.t)}
              y={TOP - 6}
              textAnchor="middle"
              className="fill-white/60 font-mono"
              fontSize={10}
            >
              {event.entry_type === 'shock' ? 'S' : 'R'}
            </text>
          </g>
        ))}

        {PANELS.map((panel, pi) => {
          const [targetLo, targetHi] = TARGETS[panel.key];
          const top = panelTop(pi);
          const ticks = niceTicks(panelScales[pi].lo, panelScales[pi].hi);
          return (
            <g key={panel.key}>
              <text x={LEFT} y={top - 8} className="fill-white/50 font-mono" fontSize={10}>
                {panel.label}
              </text>

              {/* Target band */}
              <rect
                x={LEFT}
                y={y(pi, targetHi)}
                width={W - LEFT - RIGHT}
                height={Math.max(y(pi, targetLo) - y(pi, targetHi), 0)}
                fill={BAND_FILL}
              />

              {/* Gridlines + y ticks */}
              {ticks.map((tick) => (
                <g key={tick}>
                  <line
                    x1={LEFT}
                    y1={y(pi, tick)}
                    x2={W - RIGHT}
                    y2={y(pi, tick)}
                    stroke={GRID}
                    strokeWidth={1}
                  />
                  <text
                    x={LEFT - 5}
                    y={y(pi, tick) + 3}
                    textAnchor="end"
                    className="fill-white/40 font-mono"
                    fontSize={9}
                  >
                    {fmtValue(tick)}
                  </text>
                </g>
              ))}

              {/* One line + dots per visible tub */}
              {visibleTubs.map((tubKey) => {
                const points = rows.filter((r) => r.tub === tubKey && r[panel.column] != null);
                if (points.length === 0) return null;
                const path = points
                  .map(
                    (r, i) =>
                      `${i === 0 ? 'M' : 'L'}${x(r.t).toFixed(1)},${y(pi, r[panel.column] as number).toFixed(1)}`
                  )
                  .join(' ');
                return (
                  <g key={tubKey}>
                    <path
                      d={path}
                      fill="none"
                      stroke={SERIES_COLOR[tubKey]}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    {points.map((r) => (
                      <circle
                        key={`${panel.key}-${r.id}`}
                        cx={x(r.t)}
                        cy={y(pi, r[panel.column] as number)}
                        r={hovered?.id === r.id ? 5 : 3.5}
                        fill={SERIES_COLOR[tubKey]}
                        stroke={SURFACE}
                        strokeWidth={2}
                      />
                    ))}
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* Crosshair */}
        {hoverX != null && (
          <line
            x1={hoverX}
            y1={TOP}
            x2={hoverX}
            y2={H - AXIS_H}
            stroke="rgba(255,255,255,0.35)"
            strokeWidth={1}
          />
        )}

        {/* Time axis */}
        {dayTicks.map((tick) => (
          <text
            key={tick}
            x={x(tick)}
            y={H - 8}
            textAnchor="middle"
            className="fill-white/40 font-mono"
            fontSize={9}
          >
            {fmtDay(tick)}
          </text>
        ))}
      </svg>

      {/* Tooltip: the snapped entry, values first */}
      {hovered && hoverX != null && (
        <div
          className="pointer-events-none absolute top-8 z-10 rounded border border-white/15 bg-[var(--pyre-black)] px-3 py-2 shadow-lg"
          style={
            hoverX > W / 2
              ? { right: `${100 - (hoverX / W) * 100}%`, marginRight: 8 }
              : { left: `${(hoverX / W) * 100}%`, marginLeft: 8 }
          }
        >
          <div className="mb-1 flex items-center gap-1.5 font-mono text-xs text-white/50">
            <span
              className="inline-block h-0.5 w-3 rounded"
              style={{ backgroundColor: SERIES_COLOR[hovered.tub] }}
            />
            {TUB_LABEL[hovered.tub]} · {fmtFull(hovered.t)}
            {hovered.entry_type !== 'test' && ` · ${hovered.entry_type}`}
          </div>
          {PANELS.filter((p) => hovered[p.column] != null).map((p) => (
            <div key={p.key} className="font-mono text-xs">
              <span className="font-mono-bold text-[var(--pyre-creme)]">
                {fmtValue(hovered[p.column] as number)}
              </span>{' '}
              <span className="text-white/40">{p.label}</span>
            </div>
          ))}
          {hovered.doses.length > 0 && (
            <div className="mt-1 font-mono text-xs text-white/40">
              {hovered.doses.map((d) => `${d.chemical} ${d.grams} g`).join(', ')}
            </div>
          )}
        </div>
      )}

      {events.length > 0 && (
        <p className="mt-1 font-mono text-xs text-white/30">S = shock · R = drain/refill</p>
      )}
    </div>
  );
}
