// How badly someone needs time off (time_off.severity, sub_requests.severity):
// a chip that shows it, and the optional three-way picker that sets it. Shared
// by the schedule board's sub request and the Availability sheet.

import {
  TIME_OFF_SEVERITIES,
  TIME_OFF_SEVERITY_HINTS,
  TIME_OFF_SEVERITY_LABELS,
  type TimeOffSeverity,
} from '@pyre/schedule-core';

const TONE: Record<TimeOffSeverity, string> = {
  low: 'border-white/20 bg-white/5 text-white/60',
  medium: 'border-[var(--pyre-gold)]/50 bg-[var(--pyre-gold)]/15 text-[var(--pyre-gold)]',
  high: 'border-[var(--pyre-red)]/60 bg-[var(--pyre-red)]/15 text-[var(--pyre-red)]',
};

export function SeverityChip({ severity }: { severity: TimeOffSeverity | null | undefined }) {
  if (!severity) return null;
  return (
    <span
      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${TONE[severity]}`}
      title={TIME_OFF_SEVERITY_HINTS[severity]}
    >
      {TIME_OFF_SEVERITY_LABELS[severity]}
    </span>
  );
}

/** Optional: clicking the selected level again clears it. */
export function SeverityPicker({
  value,
  onChange,
  disabled,
}: {
  value: TimeOffSeverity | null;
  onChange: (value: TimeOffSeverity | null) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-1.5" disabled={disabled}>
      <legend className="sr-only">Severity (optional)</legend>
      {TIME_OFF_SEVERITIES.map((level) => {
        const active = value === level;
        return (
          <button
            key={level}
            type="button"
            aria-pressed={active}
            title={TIME_OFF_SEVERITY_HINTS[level]}
            className={`rounded border px-2 py-1 font-mono text-xs uppercase tracking-wide transition-colors ${
              active ? TONE[level] : 'border-white/10 bg-white/5 text-white/50 hover:text-white'
            }`}
            onClick={() => onChange(active ? null : level)}
          >
            {TIME_OFF_SEVERITY_LABELS[level]}
          </button>
        );
      })}
    </fieldset>
  );
}
