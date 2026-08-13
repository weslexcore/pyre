// Multi-select staff filter for the manage-side schedule views (week board,
// month calendar, time off): pick whose time to look at. An empty selection
// means everyone — the filter only narrows, it never hides the whole board.

import { useEffect, useRef, useState } from 'react';
import type { StaffRow } from '@/lib/db';

const buttonClass =
  'px-3 py-1.5 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

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
        className={`${buttonClass} ${selected.size > 0 ? 'border-[var(--pyre-gold)]/60 text-[var(--pyre-gold)]' : ''}`}
        title="Filter to specific people's shifts and time off"
        onClick={() => setOpen(!open)}
      >
        👤 {label} ▾
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 min-w-[200px] space-y-1 rounded border border-white/15 bg-[var(--pyre-black)] p-2 shadow-lg">
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
