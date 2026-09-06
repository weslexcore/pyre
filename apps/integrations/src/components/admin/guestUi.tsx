// Shared presentation bits for the guest tools — the profile, the list, the
// roster, and the fields page all render the same badges, the same answer
// controls, and talk to the API the same way.

import type { ReactNode } from 'react';
import type { GuestFieldValue, GuestProfileFieldRow } from '@/lib/db';
import { type MembershipStanding, STANDING_LABELS } from '@/lib/guests/insights';
import { Chip, inputClass, labelClass, readError, YesNo } from './incidentUi';

const badgeBase =
  'inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide';

const STANDING_STYLES: Record<MembershipStanding, string> = {
  member: 'border-[var(--pyre-gold)]/60 bg-[var(--pyre-gold)]/10 text-[var(--pyre-gold)]',
  pack: 'border-[var(--pyre-sage)]/50 bg-[var(--pyre-sage)]/10 text-[var(--pyre-sage)]',
  none: 'border-white/15 bg-white/5 text-white/50',
};

export function StandingBadge({ standing }: { standing: MembershipStanding }) {
  return (
    <span className={`${badgeBase} ${STANDING_STYLES[standing]}`}>{STANDING_LABELS[standing]}</span>
  );
}

export function FirstVisitBadge() {
  return (
    <span
      className={`${badgeBase} border-[var(--pyre-red)]/60 bg-[var(--pyre-red)]/15 text-[var(--pyre-creme)]`}
    >
      First visit
    </span>
  );
}

export function CheckedInBadge() {
  return (
    <span
      className={`${badgeBase} border-[var(--pyre-sage)]/60 bg-[var(--pyre-sage)]/15 text-[var(--pyre-sage)]`}
    >
      Checked in
    </span>
  );
}

/** A neutral, quiet chip for tags and counts. */
export function QuietBadge({ children }: { children: ReactNode }) {
  return (
    <span className={`${badgeBase} border-white/10 bg-white/5 text-white/50`}>{children}</span>
  );
}

/** "Heat: Hot" as a compact pair, for rosters and cards. */
export function AnswerPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex max-w-full items-baseline gap-1 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs">
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-white/40">
        {label}
      </span>
      <span className="truncate text-[var(--pyre-creme)]">{value}</span>
    </span>
  );
}

/**
 * The control for one field, by kind. Value `undefined` means unanswered;
 * `onChange(null)` clears. Pick-one chips toggle off when tapped again so
 * an answer can be withdrawn without a separate clear button.
 */
export function FieldInput({
  field,
  value,
  onChange,
}: {
  field: GuestProfileFieldRow;
  value: GuestFieldValue | null | undefined;
  onChange: (next: GuestFieldValue | null) => void;
}) {
  const id = `guest-field-${field.key}`;

  switch (field.kind) {
    case 'choice':
      return (
        <div className="flex flex-wrap gap-2">
          {field.options.map((option) => (
            <Chip
              key={option}
              label={option}
              selected={value === option}
              onClick={() => onChange(value === option ? null : option)}
            />
          ))}
        </div>
      );
    case 'multi_choice': {
      const picked = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-wrap gap-2">
          {field.options.map((option) => {
            const on = picked.includes(option);
            return (
              <Chip
                key={option}
                label={option}
                selected={on}
                onClick={() => {
                  const next = on ? picked.filter((p) => p !== option) : [...picked, option];
                  onChange(next.length > 0 ? next : null);
                }}
              />
            );
          })}
        </div>
      );
    }
    case 'yes_no':
      return (
        <YesNo
          label={field.label}
          hint={field.hint ?? undefined}
          value={typeof value === 'boolean' ? value : null}
          onChange={(next) => onChange(next)}
        />
      );
    case 'number':
      return (
        <input
          id={id}
          className={inputClass}
          type="number"
          inputMode="decimal"
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      );
    default:
      return (
        <input
          id={id}
          className={inputClass}
          type="text"
          maxLength={500}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
      );
  }
}

/** Label + hint + control, laid out the same on every form. */
export function FieldRow({
  field,
  value,
  onChange,
}: {
  field: GuestProfileFieldRow;
  value: GuestFieldValue | null | undefined;
  onChange: (next: GuestFieldValue | null) => void;
}) {
  // YesNo carries its own label and hint.
  if (field.kind === 'yes_no')
    return <FieldInput field={field} value={value} onChange={onChange} />;
  return (
    <div>
      <label className={labelClass} htmlFor={`guest-field-${field.key}`}>
        {field.label}
        {field.archived && <span className="ml-2 text-white/30">(retired)</span>}
      </label>
      {field.hint && <p className="-mt-1 mb-2 text-xs text-white/40">{field.hint}</p>}
      <FieldInput field={field} value={value} onChange={onChange} />
    </div>
  );
}

/** JSON mutation against the /api/admin/guest* routes; throws with the API's message. */
export async function send<T>(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

/** Today's date as the bathhouse sees it (ET), YYYY-MM-DD. */
export function todayEastern(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/** YYYY-MM-DD plus or minus whole days, calendar-safe. */
export function shiftDate(date: string, days: number): string {
  const ms = Date.parse(`${date}T12:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** "Tue, Sep 8" for a YYYY-MM-DD, read in ET. */
export function formatDateLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** "6:00 – 8:00 PM" in ET. */
export function formatTimeRange(startIso: string, endIso: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  };
  const start = new Date(startIso).toLocaleTimeString('en-US', opts);
  const end = new Date(endIso).toLocaleTimeString('en-US', opts);
  return `${start} – ${end}`;
}

/** "Sep 2026" for first/last seen dates. */
export function formatMonth(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  return new Date(ms).toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    year: 'numeric',
  });
}
