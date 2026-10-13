// A small "i" button beside a label that reveals a short explanation on
// hover or tap. Anchors the panel to the wrapping row rather than the 16px
// button so it stays inside the content column on a phone.

import { useState } from 'react';

export function InfoTip({
  label,
  text,
  align = 'left',
}: {
  label: string;
  text: string;
  /** 'right' opens the panel leftward, for a tip at the right edge of a card. */
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex group">
      <button
        type="button"
        aria-label={`What is ${label}?`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/30 text-[10px] leading-none text-white/50 transition-colors hover:border-white/60 hover:text-white"
      >
        i
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute ${align === 'right' ? 'right-0' : 'left-0'} top-5 z-20 w-56 max-w-[70vw] rounded border border-white/20 bg-[var(--pyre-black)] px-2.5 py-1.5 text-[11px] font-normal normal-case tracking-normal leading-snug text-white/70 shadow-lg transition-opacity group-hover:opacity-100 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {text}
      </span>
    </span>
  );
}
