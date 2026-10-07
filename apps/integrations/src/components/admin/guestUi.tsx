// Shared presentation bits for the guest tools — the profile, the list, the
// roster, and the fields page all render the same badges, the same answer
// controls, and talk to the API the same way.

import { type ReactNode, useEffect, useState } from 'react';
import { answerLimit } from '@/lib/boards/types';
import { formatPhone, KIND_PROBLEMS, normalizeAnswer, phoneOf } from '@/lib/boards/validate';
import type {
  BoardFieldKind,
  ChecklistAnswer,
  GuestFieldValue,
  GuestProfileFieldRow,
} from '@/lib/db';
import { type MembershipStanding, STANDING_LABELS } from '@/lib/guests/insights';
import { textareaClass } from './goalsUi';
import { Chip, inputClass, labelClass, YesNo } from './incidentUi';

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
 * A field this control can render, structurally rather than by table: a guest
 * profile field and a board field ask the same questions in the same shapes,
 * so the control is shared and the row types stay where they belong. `kind`
 * is widened to the union of both — `date`, `datetime`, `time`, `time_range`, and
 * `files` only arrive from boards. A `files` answer is uploads, which need a
 * board to go to, so the card drawer and the form mount their own control
 * (boards/FilesField) for that kind; here it only says so.
 */
export interface FieldDefinition {
  key: string;
  label: string;
  kind:
    | GuestProfileFieldRow['kind']
    | 'long_text'
    | 'email'
    | 'phone'
    | 'date'
    | 'datetime'
    | 'time'
    | 'time_range'
    | 'files'
    | 'card_link'
    | 'checklist';
  options: string[];
  hint?: string | null;
  archived?: boolean;
}

/**
 * The control for one field, by kind. Value `undefined` means unanswered;
 * `onChange(null)` clears. Pick-one chips and yes/no toggle off when tapped again so
 * an answer can be withdrawn without a separate clear button.
 */
function isPlainAnswer(
  value: GuestFieldValue | ChecklistAnswer | null | undefined
): value is GuestFieldValue | null | undefined {
  return !value || typeof value !== 'object' || Array.isArray(value);
}

export function FieldInput({
  field,
  value: raw,
  onChange,
  idPrefix = 'guest-field',
  multiple,
  min,
}: {
  field: FieldDefinition;
  /** A checklist answer is drawn by the card's own Checklist, never here. */
  value: GuestFieldValue | ChecklistAnswer | null | undefined;
  onChange: (next: GuestFieldValue | null) => void;
  /** Namespaces the input id so two forms on one page don't collide. */
  idPrefix?: string;
  /**
   * A date, date & time, or time field takes several unless told to take
   * one (a form question can say so).
   */
  multiple?: boolean;
  /**
   * For a date or date & time field: the earliest day the picker offers. A form question
   * that insists on a date still to come passes today, so the past is greyed
   * out rather than merely refused after the fact.
   */
  min?: string;
}) {
  const id = `${idPrefix}-${field.key}`;
  if (field.kind === 'checklist') {
    return <p className="text-xs text-white/35">The checklist is worked through on the card.</p>;
  }
  // Only a checklist stores an object, and it was handled above.
  const value = isPlainAnswer(raw) ? raw : undefined;

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
          label={field.archived ? `${field.label} (retired)` : field.label}
          hint={field.hint ?? undefined}
          value={typeof value === 'boolean' ? value : null}
          onChange={(next) => onChange(next)}
          onClear={() => onChange(null)}
        />
      );
    case 'long_text':
      // The card's notes control, borrowed: the same box, wrapping at the
      // edge, and draggable taller by whoever is filling it in.
      return (
        <textarea
          id={id}
          className={`${textareaClass} resize-y`}
          maxLength={answerLimit('long_text')}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
      );
    case 'email':
      return (
        <input
          id={id}
          className={inputClass}
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={254}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        />
      );
    case 'phone':
      return <PhoneInput id={id} value={value} onChange={onChange} />;
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
    case 'date':
      if (multiple === false) {
        // One date: the stored answer may still be a list from the drawer, so show its first.
        const single = Array.isArray(value)
          ? (value[0] ?? '')
          : typeof value === 'string'
            ? value
            : '';
        return (
          <input
            id={id}
            className={inputClass}
            type="date"
            min={min}
            value={single}
            onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          />
        );
      }
      return <DatesInput id={id} label={field.label} value={value} onChange={onChange} min={min} />;
    case 'datetime':
      return (
        <DateTimesInput
          id={id}
          label={field.label}
          value={value}
          onChange={onChange}
          min={min}
          single={multiple === false}
        />
      );
    case 'time':
      if (multiple === false) {
        const single = Array.isArray(value)
          ? (value[0] ?? '')
          : typeof value === 'string'
            ? value
            : '';
        return (
          <input
            id={id}
            className={inputClass}
            type="time"
            value={single}
            onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          />
        );
      }
      return (
        <DatesInput id={id} label={field.label} value={value} onChange={onChange} type="time" />
      );
    case 'time_range':
      return <TimeRangeInput id={id} value={value} onChange={onChange} />;
    case 'files':
      return <p className="text-xs text-white/35">Files are added from the card.</p>;
    case 'card_link':
      return <p className="text-xs text-white/35">Cards are linked from the card.</p>;
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

/**
 * A phone number, written the one way. Whatever anybody types — brackets,
 * dots, dashes, spaces, a country code or not — is read into the canonical
 * +<country><digits> that is stored, and what is shown is that number in
 * the house format. So a number typed as 212.555.1234 on one card and as
 * (212) 555 1234 on another reads identically in the drawer, on the card,
 * and on a form.
 *
 * While the field has focus it holds exactly what is being typed, because
 * reformatting under somebody's cursor moves it; the tidying happens on the
 * way out. Something that is not a number yet is still passed up as typed,
 * so FieldRow can say so rather than the answer vanishing.
 */
function PhoneInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: GuestFieldValue | null | undefined;
  onChange: (next: GuestFieldValue | null) => void;
}) {
  const stored = typeof value === 'string' ? value : '';
  // Non-null only while the field is being typed into.
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      id={id}
      className={inputClass}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      maxLength={40}
      value={draft ?? formatPhone(stored)}
      onFocus={() => setDraft(formatPhone(stored))}
      onChange={(e) => {
        const typed = e.target.value;
        setDraft(typed);
        if (!typed.trim()) {
          onChange(null);
          return;
        }
        // The canonical number once it is one, and the raw text until then.
        onChange(phoneOf(typed) ?? typed);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

/**
 * One picker per date (or time — `type` says), with room for one more. The slots are the control's
 * own, not derived from the saved answer: a date input reports '' the
 * moment one of its segments is deleted, and a row that vanished on that
 * would take the half-typed date with it. So a slot stays while it is
 * being typed in, the answer hears only the finished dates, and a change
 * made elsewhere (a calendar drag) is followed only when what is stored
 * no longer matches what the slots say.
 */
function DatesInput({
  id,
  label,
  value,
  onChange,
  min,
  type = 'date',
}: {
  id: string;
  label: string;
  value: GuestFieldValue | null | undefined;
  onChange: (next: GuestFieldValue | null) => void;
  /** The earliest value the picker offers, in its own shape; undefined offers any. */
  min?: string;
  /** What each slot holds: a day or a time. */
  type?: 'date' | 'time';
}) {
  const noun = type;
  const stored = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];
  const storedKey = stored.join('|');
  const [slots, setSlots] = useState<string[]>(() => (stored.length > 0 ? stored : ['']));
  useEffect(() => {
    setSlots((current) => {
      if (current.filter(Boolean).join('|') === storedKey) return current;
      return storedKey ? storedKey.split('|') : [''];
    });
  }, [storedKey]);

  const emit = (next: string[]) => {
    const unique = [...new Set(next.filter(Boolean))];
    onChange(unique.length === 0 ? null : unique.length === 1 ? unique[0] : unique);
  };
  const update = (index: number, date: string) => {
    const next = slots.map((slot, i) => (i === index ? date : slot));
    setSlots(next);
    emit(next);
  };
  const remove = (index: number) => {
    const rest = slots.filter((_, i) => i !== index);
    const next = rest.length > 0 ? rest : [''];
    setSlots(next);
    emit(next);
  };

  return (
    <div className="space-y-2">
      {slots.map((date, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Controlled picker slots retain focus while their date changes.
        <div key={index} className="flex items-center gap-2">
          <input
            id={index === 0 ? id : `${id}-${index}`}
            aria-label={`${label}, ${noun} ${index + 1}`}
            className={inputClass}
            type={type}
            min={min}
            value={date}
            onChange={(event) => update(index, event.target.value)}
          />
          {(slots.length > 1 || date) && (
            <button
              type="button"
              className="text-xs text-white/60 hover:text-white"
              aria-label={`Remove ${label} ${noun} ${index + 1}`}
              onClick={() => remove(index)}
            >
              Remove
            </button>
          )}
        </div>
      ))}
      {slots.every(Boolean) && (
        <button
          type="button"
          className="text-xs text-white/60 hover:text-white"
          onClick={() => setSlots((current) => [...current, ''])}
        >
          Add another {noun}
        </button>
      )}
    </div>
  );
}

/** A date & time slot as it is being filled in: the day, and the time if any. */
interface MomentSlot {
  date: string;
  time: string;
}

function slotOf(stored: string): MomentSlot {
  return { date: stored.slice(0, 10), time: stored.length > 10 ? stored.slice(11, 16) : '' };
}

/** What a slot stores: the day, with its time when one is given; '' until there is a day. */
function momentOfSlot(slot: MomentSlot): string {
  if (!slot.date) return '';
  return slot.time ? `${slot.date}T${slot.time}` : slot.date;
}

/**
 * A date and an optional time per answer, with room for one more unless
 * `single`. Two inputs rather than one datetime-local, because that control
 * cannot be left without a time, and a day whose hour nobody has agreed yet
 * is still worth writing down. The slots are kept the way DatesInput keeps
 * them: a time picked before its day waits in its slot rather than vanishing,
 * and only finished answers are passed up.
 */
function DateTimesInput({
  id,
  label,
  value,
  onChange,
  min,
  single = false,
}: {
  id: string;
  label: string;
  value: GuestFieldValue | null | undefined;
  onChange: (next: GuestFieldValue | null) => void;
  /** The earliest day the picker offers; undefined offers any. */
  min?: string;
  /** One answer only: no adding, and a list from the drawer shows its first. */
  single?: boolean;
}) {
  const all = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];
  const stored = single ? all.slice(0, 1) : all;
  const storedKey = stored.join('|');
  const [slots, setSlots] = useState<MomentSlot[]>(() =>
    stored.length > 0 ? stored.map(slotOf) : [{ date: '', time: '' }]
  );
  useEffect(() => {
    setSlots((current) => {
      if (current.map(momentOfSlot).filter(Boolean).join('|') === storedKey) return current;
      return storedKey ? storedKey.split('|').map(slotOf) : [{ date: '', time: '' }];
    });
  }, [storedKey]);

  const emit = (next: MomentSlot[]) => {
    const unique = [...new Set(next.map(momentOfSlot).filter(Boolean))];
    onChange(unique.length === 0 ? null : unique.length === 1 ? unique[0] : unique);
  };
  const update = (index: number, patch: Partial<MomentSlot>) => {
    const next = slots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot));
    setSlots(next);
    emit(next);
  };
  const remove = (index: number) => {
    const rest = slots.filter((_, i) => i !== index);
    const next = rest.length > 0 ? rest : [{ date: '', time: '' }];
    setSlots(next);
    emit(next);
  };

  return (
    <div className="space-y-2">
      {slots.map((slot, index) => {
        const n = single ? '' : ` ${index + 1}`;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: Controlled picker slots retain focus while their value changes.
          <div key={index} className="flex items-center gap-2">
            <input
              id={index === 0 ? id : `${id}-${index}`}
              aria-label={`${label}, date${n}`}
              className={`${inputClass} min-w-0 flex-[3]`}
              type="date"
              min={min}
              value={slot.date}
              onChange={(event) => update(index, { date: event.target.value })}
            />
            <input
              aria-label={`${label}, time${n} (optional)`}
              className={`${inputClass} min-w-0 flex-[2]`}
              type="time"
              value={slot.time}
              onChange={(event) => update(index, { time: event.target.value })}
            />
            {!single && (slots.length > 1 || slot.date || slot.time) && (
              <button
                type="button"
                className="shrink-0 text-xs text-white/60 hover:text-white"
                aria-label={`Remove ${label} date${n}`}
                onClick={() => remove(index)}
              >
                Remove
              </button>
            )}
          </div>
        );
      })}
      {!single && slots.every((slot) => slot.date) && (
        <button
          type="button"
          className="text-xs text-white/60 hover:text-white"
          onClick={() => setSlots((current) => [...current, { date: '', time: '' }])}
        >
          Add another date
        </button>
      )}
    </div>
  );
}

/**
 * Two clocks for one answer. The halves live here while they are being
 * typed; the field only hears about a complete pair (or null once either
 * side is cleared), so nothing half-entered is ever sent to be saved.
 */
function TimeRangeInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: GuestFieldValue | null | undefined;
  onChange: (next: GuestFieldValue | null) => void;
}) {
  const stored = Array.isArray(value) && value.length === 2 ? value : null;
  const [start, setStart] = useState(stored?.[0] ?? '');
  const [end, setEnd] = useState(stored?.[1] ?? '');
  const update = (nextStart: string, nextEnd: string) => {
    setStart(nextStart);
    setEnd(nextEnd);
    onChange(nextStart && nextEnd ? [nextStart, nextEnd] : null);
  };
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        className={inputClass}
        type="time"
        aria-label="Start"
        value={start}
        onChange={(e) => update(e.target.value, end)}
      />
      <span className="font-mono text-xs text-white/40">to</span>
      <input
        id={`${id}-end`}
        className={inputClass}
        type="time"
        aria-label="End"
        value={end}
        onChange={(e) => update(start, e.target.value)}
      />
    </div>
  );
}

/**
 * Label + hint + control, laid out the same on every form, and on the way
 * out it says whether what was typed can be what the field is. That matters
 * most where nothing else would say so: a card drawer saves as you type,
 * and an address that is not an address is dropped by the route without a
 * word (lib/boards/validate normalizeProperties). Now the row says it.
 *
 * Only on leaving the field, and only about something actually typed —
 * while somebody is still mid-address they are not yet wrong.
 */
export function FieldRow({
  field,
  value,
  onChange,
  idPrefix = 'guest-field',
}: {
  field: FieldDefinition;
  value: GuestFieldValue | ChecklistAnswer | null | undefined;
  onChange: (next: GuestFieldValue | null) => void;
  idPrefix?: string;
}) {
  const [problem, setProblem] = useState<string | null>(null);

  // YesNo carries its own label and hint, and no yes/no can be mistyped.
  if (field.kind === 'yes_no')
    return <FieldInput field={field} value={value} onChange={onChange} idPrefix={idPrefix} />;

  const check = () => {
    const message = KIND_PROBLEMS[field.kind as BoardFieldKind];
    if (!message) return;
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
      setProblem(null);
      return;
    }
    const kind = field.kind as BoardFieldKind;
    setProblem(normalizeAnswer({ kind, options: field.options }, value) === null ? message : null);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Focus leaving the field, not a mouse affordance: onBlur adds nothing a keyboard cannot reach.
    <div onBlur={check}>
      <label className={labelClass} htmlFor={`${idPrefix}-${field.key}`}>
        {field.label}
        {field.archived && <span className="ml-2 text-white/30">(retired)</span>}
      </label>
      {field.hint && <p className="-mt-1 mb-2 text-xs text-white/40">{field.hint}</p>}
      <FieldInput
        field={field}
        value={value}
        idPrefix={idPrefix}
        onChange={(next) => {
          setProblem(null);
          onChange(next);
        }}
      />
      {problem && (
        <p role="alert" className="mt-1 text-sm text-[var(--pyre-red)]">
          {problem}
        </p>
      )}
    </div>
  );
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
