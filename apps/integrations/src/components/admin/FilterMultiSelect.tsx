// A dropdown that looks like the plain <select> filters beside it but lets
// several options be ticked at once. The button names the filter ("Status")
// while nothing is picked; an empty selection means no filtering at all.

import { useCallback, useEffect, useRef, useState } from 'react';

/** Breathing room kept between the panel and the edge of the viewport. */
const EDGE_MARGIN = 8;

export interface FilterOption<T extends string> {
  value: T;
  label: string;
}

export function FilterMultiSelect<T extends string>({
  placeholder,
  options,
  selected,
  onChange,
  className,
}: {
  placeholder: string;
  options: readonly FilterOption<T>[];
  selected: ReadonlySet<T>;
  onChange: (next: ReadonlySet<T>) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Keep the panel inside the viewport when the button wraps near the right
  // edge on a phone (same approach as StaffMultiSelect).
  const positionPanel = useCallback((panel: HTMLDivElement | null) => {
    if (!panel || !rootRef.current) return;
    panel.style.transform = '';
    const viewport = document.documentElement.clientWidth;
    const left = rootRef.current.getBoundingClientRect().left;
    const rightmost = Math.max(EDGE_MARGIN, viewport - EDGE_MARGIN - panel.offsetWidth);
    const offset = Math.min(Math.max(left, EDGE_MARGIN), rightmost) - left;
    if (offset !== 0) panel.style.transform = `translateX(${offset}px)`;
  }, []);

  const picked = options.filter((o) => selected.has(o.value));
  const label =
    picked.length === 0
      ? placeholder
      : picked.length === 1
        ? `${placeholder}: ${picked[0].label}`
        : `${placeholder}: ${picked.length}`;

  const toggle = (value: T) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={`${className ?? ''} flex items-center gap-2 ${picked.length === 0 ? 'text-white/50' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Filter by ${placeholder.toLowerCase()}`}
        onClick={() => setOpen(!open)}
      >
        {label}
        <span aria-hidden="true" className="text-[10px] text-white/40">
          ▾
        </span>
      </button>
      {open && (
        <div
          ref={positionPanel}
          className="absolute left-0 top-full z-20 mt-1 max-h-[60vh] min-w-[180px] max-w-[calc(100vw-1rem)] space-y-1 overflow-y-auto overscroll-contain rounded border border-white/15 bg-[var(--pyre-black)] p-2 shadow-lg"
        >
          {options.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 font-mono text-xs text-white/80 hover:bg-white/5"
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[var(--pyre-red)]"
                checked={selected.has(o.value)}
                onChange={() => toggle(o.value)}
              />
              {o.label}
            </label>
          ))}
          {picked.length > 0 && (
            <button
              type="button"
              className="mt-1 w-full rounded border border-white/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-white/50 hover:text-white"
              onClick={() => onChange(new Set())}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
