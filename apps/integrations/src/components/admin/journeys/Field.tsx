// Labels for the journey editor: every field gets a clear label, an "i" tip
// explaining what it does, and (optionally) a one-line hint underneath.
// Sections group fields under a numbered heading that reads in the order
// you'd think it through.

import type { ReactNode } from 'react';
import { InfoTip } from '@/components/admin/InfoTip';

export function FieldLabel({
  label,
  tip,
  htmlFor,
}: {
  label: string;
  tip?: string;
  htmlFor?: string;
}) {
  return (
    <span className="mb-1.5 flex items-center gap-1.5">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-sm font-medium text-[var(--pyre-creme)]">
          {label}
        </label>
      ) : (
        <span className="text-sm font-medium text-[var(--pyre-creme)]">{label}</span>
      )}
      {tip && <InfoTip label={label} text={tip} />}
    </span>
  );
}

export function Field({
  label,
  tip,
  hint,
  htmlFor,
  children,
  className = '',
}: {
  label: string;
  /** What the field does, shown from the "i" button. */
  tip?: string;
  /** A short line under the control. */
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col ${className}`}>
      <FieldLabel label={label} tip={tip} htmlFor={htmlFor} />
      {children}
      {hint && <p className="mt-1 text-xs leading-relaxed text-white/45">{hint}</p>}
    </div>
  );
}

export function Section({
  number,
  title,
  description,
  children,
  aside,
}: {
  number?: number;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Something on the right of the heading (a status, a button). */
  aside?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          {number !== undefined && (
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--pyre-gold)]/50 font-mono text-xs text-[var(--pyre-gold)]">
              {number}
            </span>
          )}
          <div>
            <h3 className="text-base font-semibold text-[var(--pyre-creme)]">{title}</h3>
            {description && (
              <p className="mt-0.5 text-xs leading-relaxed text-white/50">{description}</p>
            )}
          </div>
        </div>
        {aside}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}
