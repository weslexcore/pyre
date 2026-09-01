// Multi-select staff filter for the manage-side schedule views (week board,
// month calendar, time off): pick whose time to look at. An empty selection
// means everyone — the filter only narrows, it never hides the whole board.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { StaffRow } from '@/lib/db';
import { filterChipClass } from './scheduleUi';

/** Breathing room kept between the panel and the edge of the viewport. */
const EDGE_MARGIN = 8;

export function StaffMultiSelect({
  staff,
  selected,
  onChange,
}: {
  staff: StaffRow[];
  selected: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // The button wraps onto whichever toolbar line it fits, so on a phone it can
  // sit close enough to the right edge that a left-aligned panel would hang off
  // the viewport and scroll the whole page sideways — nudge it back inside.
  // A ref callback (rather than a layout effect, which React warns about in the
  // server render Astro does for this island) runs on commit, before paint, so
  // the panel is never seen in the wrong place.
  const positionPanel = useCallback((panel: HTMLDivElement | null) => {
    if (!panel || !rootRef.current) return;
    panel.style.transform = '';
    const viewport = document.documentElement.clientWidth;
    const left = rootRef.current.getBoundingClientRect().left;
    const rightmost = Math.max(EDGE_MARGIN, viewport - EDGE_MARGIN - panel.offsetWidth);
    const offset = Math.min(Math.max(left, EDGE_MARGIN), rightmost) - left;
    if (offset !== 0) panel.style.transform = `translateX(${offset}px)`;
  }, []);

  const active = staff.filter((s) => s.active);
  const label =
    selected.size === 0
      ? 'Everyone'
      : selected.size === 1
        ? (active.find((s) => selected.has(s.id))?.display_name ?? '1 person')
        : `${selected.size} people`;

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={filterChipClass(selected.size > 0)}
        aria-haspopup="true"
        aria-expanded={open}
        title="Filter to specific people's shifts and time off"
        onClick={() => setOpen(!open)}
      >
        👤 {label} ▾
      </button>
      {open && (
        <div
          ref={positionPanel}
          className="absolute left-0 top-full z-20 mt-1 max-h-[60vh] min-w-[200px] max-w-[calc(100vw-1rem)] space-y-1 overflow-y-auto overscroll-contain rounded border border-white/15 bg-[var(--pyre-black)] p-2 shadow-lg"
        >
          {active.map((s) => (
            <label
              key={s.id}
              className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 font-mono text-xs text-white/80 hover:bg-white/5"
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[var(--pyre-red)]"
                checked={selected.has(s.id)}
                onChange={() => toggle(s.id)}
              />
              {s.display_name}
            </label>
          ))}
          {selected.size > 0 && (
            <button
              type="button"
              className="mt-1 w-full rounded border border-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-white/50 hover:text-white"
              onClick={() => onChange(new Set())}
            >
              Clear — show everyone
            </button>
          )}
        </div>
      )}
    </div>
  );
}
