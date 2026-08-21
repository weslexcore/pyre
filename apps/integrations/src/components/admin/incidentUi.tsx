// Shared presentation bits for the incident tools — the form, the log, and
// the report page all render the same badges and use the same control
// styling, so a severity reads identically wherever it appears.

import type { ReactNode } from 'react';
import {
  type IncidentSeverity,
  type IncidentStatus,
  severityLabel,
  statusLabel,
} from '@/lib/incidents/types';

// Touch targets first: this form is filled out on a phone, one-handed,
// usually while something else still needs attention.
export const inputClass =
  'w-full px-3 py-3 rounded bg-white/5 border border-white/10 text-base text-[var(--pyre-creme)] placeholder-white/30 focus:outline-none focus:border-white/30';

export const labelClass = 'block mb-1.5 font-mono text-xs uppercase tracking-wide text-white/50';

export const buttonClass =
  'px-3 py-2 rounded border border-white/10 bg-white/5 text-xs font-mono uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white transition-colors disabled:opacity-40';

export const primaryButtonClass =
  'px-5 py-3 rounded bg-[var(--pyre-red)] text-sm font-mono-bold uppercase tracking-wide text-[var(--pyre-creme)] hover:brightness-110 transition disabled:opacity-40 disabled:hover:brightness-100';

export const cardClass = 'rounded border border-white/10 bg-white/[0.03] p-4';

/** Big tappable option used by the category/severity/area pickers. */
export function TileButton({
  selected,
  label,
  hint,
  onClick,
}: {
  selected: boolean;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded border px-3 py-3 text-left transition-colors ${
        selected
          ? 'border-[var(--pyre-red)] bg-[var(--pyre-red)]/15 text-[var(--pyre-creme)]'
          : 'border-white/10 bg-white/5 text-white/80 hover:border-white/30'
      }`}
    >
      <span className="block text-sm font-primary-semibold leading-tight">{label}</span>
      {hint && <span className="mt-0.5 block text-xs leading-snug text-white/45">{hint}</span>}
    </button>
  );
}

/** Small toggle chip for multi-select lists (contributing factors, body parts). */
export function Chip({
  selected,
  label,
  onClick,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-full border px-3 py-1.5 font-mono text-xs transition-colors ${
        selected
          ? 'border-[var(--pyre-gold)] bg-[var(--pyre-gold)]/15 text-[var(--pyre-gold)]'
          : 'border-white/10 bg-white/5 text-white/60 hover:border-white/30'
      }`}
    >
      {label}
    </button>
  );
}

/** Yes/no pair — clearer than a checkbox on a form that becomes a record. */
export function YesNo({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: boolean | null;
  onChange: (next: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 py-2.5 last:border-0">
      <span className="text-sm text-white/80">
        {label}
        {hint && <span className="mt-0.5 block text-xs text-white/40">{hint}</span>}
      </span>
      <span className="flex shrink-0 gap-1">
        {[
          { on: true, text: 'Yes' },
          { on: false, text: 'No' },
        ].map((opt) => (
          <button
            key={opt.text}
            type="button"
            onClick={() => onChange(opt.on)}
            aria-pressed={value === opt.on}
            className={`w-14 rounded border px-2 py-1.5 font-mono text-xs uppercase transition-colors ${
              value === opt.on
                ? opt.on
                  ? 'border-[var(--pyre-red)] bg-[var(--pyre-red)]/20 text-[var(--pyre-creme)]'
                  : 'border-white/30 bg-white/10 text-white/80'
                : 'border-white/10 bg-white/5 text-white/40 hover:border-white/25'
            }`}
          >
            {opt.text}
          </button>
        ))}
      </span>
    </div>
  );
}

const SEVERITY_STYLES: Record<IncidentSeverity, string> = {
  near_miss: 'border-white/20 bg-white/5 text-white/60',
  minor: 'border-[var(--pyre-sage)]/50 bg-[var(--pyre-sage)]/10 text-[var(--pyre-sage)]',
  moderate: 'border-[var(--pyre-gold)]/50 bg-[var(--pyre-gold)]/10 text-[var(--pyre-gold)]',
  severe: 'border-[var(--pyre-red)]/60 bg-[var(--pyre-red)]/15 text-[var(--pyre-red)]',
  critical: 'border-[var(--pyre-red)] bg-[var(--pyre-red)]/30 text-[var(--pyre-creme)]',
};

const badgeBase =
  'inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide';

export function SeverityBadge({ severity }: { severity: string }) {
  const style =
    SEVERITY_STYLES[severity as IncidentSeverity] ?? 'border-white/20 bg-white/5 text-white/60';
  return <span className={`${badgeBase} ${style}`}>{severityLabel(severity)}</span>;
}

const STATUS_STYLES: Record<IncidentStatus, string> = {
  submitted: 'border-[var(--pyre-gold)]/50 text-[var(--pyre-gold)]',
  under_review: 'border-[var(--pyre-blue)]/70 text-white/70',
  action_required: 'border-[var(--pyre-red)]/60 text-[var(--pyre-red)]',
  resolved: 'border-[var(--pyre-sage)]/50 text-[var(--pyre-sage)]',
  closed: 'border-white/20 text-white/45',
  voided: 'border-white/15 text-white/30 line-through',
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status as IncidentStatus] ?? 'border-white/20 text-white/50';
  return <span className={`${badgeBase} bg-transparent ${style}`}>{statusLabel(status)}</span>;
}

/** Section heading inside a step or a report panel. */
export function SectionTitle({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-base font-primary-semibold text-[var(--pyre-creme)]">{children}</h2>
      {note && <p className="mt-0.5 text-xs leading-snug text-white/45">{note}</p>}
    </div>
  );
}

/** Bathhouse wall-clock formatting — the log is read in local terms. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  return new Date(ms).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDayAndTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  return new Date(ms).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export async function readError(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}
