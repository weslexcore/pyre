// A labelled row of links to related pages — the SOPs on a board, the boards
// an SOP serves. Wraps on a phone.

import type { ReactNode } from 'react';

/** One link in a LinkedRow. */
export const linkedChipClass =
  'rounded border border-white/15 bg-white/5 px-2.5 py-1 text-xs text-[var(--pyre-creme)] transition-colors hover:border-[var(--pyre-gold)]/60 hover:text-[var(--pyre-gold)]';

export function LinkedRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-wide text-white/40">{label}</span>
      {children}
    </div>
  );
}
