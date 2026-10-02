// Shared presentation bits for the /admin/inventory islands: the dialog
// panel, the quantity stepper, and the badges that read the same on the
// stock, history, and setup screens.

import type { ReactNode } from 'react';
import { formatQuantity } from '@/lib/inventory/rules';
import { MOVEMENT_LABELS, type MovementType } from '@/lib/inventory/types';

export const INVENTORY_API = '/api/admin/inventory';
export const MOVEMENTS_API = '/api/admin/inventory-movements';

/**
 * The item a link asked to open (`?item=<id>`, from the global search), read
 * once and then dropped from the address bar, so closing the dialog and
 * reloading doesn't open it again.
 */
export function takeItemParam(): string | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const id = url.searchParams.get('item');
  if (!id) return null;
  url.searchParams.delete('item');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  return id;
}

export const dialogPanelClass =
  'flex max-h-[90vh] max-w-lg flex-col overflow-y-auto rounded-t-lg border border-white/15 bg-[var(--pyre-black)] p-4 shadow-xl sm:rounded-lg';

const badgeBase =
  'inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide';

/** Re-order level reached. */
export function LowBadge({ children = 'Low' }: { children?: ReactNode }) {
  return (
    <span
      className={`${badgeBase} border-[var(--pyre-red)]/50 bg-[var(--pyre-red)]/15 text-[var(--pyre-red)]`}
    >
      {children}
    </span>
  );
}

// Loss types read red, inflow green, everything else quiet — the colour is a
// hint; the label always carries the meaning.
const TYPE_TONE: Record<MovementType, string> = {
  initial: 'border-white/15 bg-white/5 text-white/60',
  receive: 'border-[var(--pyre-sage)]/50 bg-[var(--pyre-sage)]/15 text-[var(--pyre-sage)]',
  use: 'border-white/15 bg-white/5 text-white/70',
  waste: 'border-[var(--pyre-red)]/50 bg-[var(--pyre-red)]/10 text-[var(--pyre-red)]',
  count_adjust: 'border-[var(--pyre-gold)]/50 bg-[var(--pyre-gold)]/10 text-[var(--pyre-gold)]',
  transfer: 'border-white/15 bg-white/5 text-white/60',
  correction: 'border-white/15 bg-white/5 text-white/60',
};

export function MovementBadge({ type }: { type: MovementType }) {
  return <span className={`${badgeBase} ${TYPE_TONE[type]}`}>{MOVEMENT_LABELS[type]}</span>;
}

/** '+24' / '-2' for a ledger row. */
export function signed(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatQuantity(Math.abs(n))}`;
}

/**
 * Big − / number / + control, sized for a thumb. Keeps its value as the
 * raw string so a half-typed "2." doesn't snap back.
 */
export function QuantityStepper({
  value,
  onChange,
  label,
  step = 1,
  id,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  step?: number;
  id: string;
}) {
  const current = Number(value) || 0;
  const bump = (delta: number) => onChange(formatQuantity(Math.max(0, current + delta)));
  const stepButton =
    'h-12 w-12 shrink-0 rounded border border-white/15 bg-white/5 text-2xl leading-none text-[var(--pyre-creme)] hover:border-white/30 disabled:opacity-30';
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={stepButton}
        onClick={() => bump(-step)}
        disabled={current <= step}
        aria-label={`Decrease ${label}`}
      >
        −
      </button>
      <input
        id={id}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
        aria-label={label}
        className="h-12 w-24 min-w-0 rounded border border-white/10 bg-white/5 text-center text-xl text-[var(--pyre-creme)] focus:border-white/30 focus:outline-none"
      />
      <button
        type="button"
        className={stepButton}
        onClick={() => bump(step)}
        aria-label={`Increase ${label}`}
      >
        +
      </button>
    </div>
  );
}
