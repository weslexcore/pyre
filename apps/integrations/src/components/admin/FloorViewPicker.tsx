// The Check Ins view picker: which sessions' guests the page shows. Square
// pills (scheduleUi) because they change what you are looking at. A day gets
// Prev/Today/Next and a date; a range gets two times on the studio clock,
// applied as soon as they make a range the route would accept.

import { easternToUtc, utcToEastern } from '@pyre/schedule-core';
import { useState } from 'react';
import { pillClass } from '@/components/admin/scheduleUi';
import { compactInputClass, formButtonClass } from '@/components/admin/ui';
import { type FloorView, MINUTE_MS, parseFloorView } from '@/lib/guests/floor-timing';
import { formatDateLabel, shiftDate } from './guestUi';

const KINDS: { kind: FloorView['kind']; label: string }[] = [
  { kind: 'floor', label: 'Now' },
  { kind: 'current', label: 'This session' },
  { kind: 'next', label: 'Next session' },
  { kind: 'day', label: 'Day' },
  { kind: 'custom', label: 'Range' },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/** "2026-11-05T18:05" on the studio clock, for a datetime-local input. */
function wallClockStamp(iso: string): string {
  const { date, minutes } = utcToEastern(iso);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${date}T${hh}:${mm}`;
}

/** The instant a datetime-local value names on the studio clock, or null while half-typed. */
function fromWallClockStamp(value: string): string | null {
  const [date = '', time = ''] = value.split('T');
  return DATE_RE.test(date) && TIME_RE.test(time.slice(0, 5))
    ? easternToUtc(date, time.slice(0, 5))
    : null;
}

/** The range first offered: from the top of this hour, four hours on. */
export function defaultRange(nowMs: number): { from: string; to: string } {
  const from = nowMs - (nowMs % (60 * MINUTE_MS));
  return {
    from: new Date(from).toISOString(),
    to: new Date(from + 4 * 60 * MINUTE_MS).toISOString(),
  };
}

export function FloorViewPicker({
  view,
  today,
  onChange,
}: {
  view: FloorView;
  today: string;
  onChange: (next: FloorView) => void;
}) {
  // The range inputs as typed, kept while they don't yet make a valid range.
  const [draft, setDraft] = useState<{ from: string; to: string } | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);

  const pick = (kind: FloorView['kind']) => {
    setDraft(null);
    setRangeError(null);
    switch (kind) {
      case 'day':
        onChange({ kind, date: view.kind === 'day' ? view.date : today });
        break;
      case 'custom':
        onChange(view.kind === 'custom' ? view : { kind, ...defaultRange(Date.now()) });
        break;
      default:
        onChange({ kind });
    }
  };

  const editRange = (next: { from: string; to: string }) => {
    setDraft(next);
    const from = fromWallClockStamp(next.from);
    const to = fromWallClockStamp(next.to);
    if (!from || !to) return;
    const parsed = parseFloorView({ view: 'custom', from, to });
    if (parsed.ok) {
      setDraft(null);
      setRangeError(null);
      onChange(parsed.value);
    } else {
      setRangeError(parsed.error);
    }
  };

  const range =
    view.kind === 'custom'
      ? (draft ?? { from: wallClockStamp(view.from), to: wallClockStamp(view.to) })
      : null;

  return (
    <div className="space-y-2">
      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="sr-only">Show guests from</legend>
        {KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            className={pillClass(view.kind === k.kind)}
            aria-pressed={view.kind === k.kind}
            onClick={() => pick(k.kind)}
          >
            {k.label}
          </button>
        ))}
      </fieldset>

      {view.kind === 'day' && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={formButtonClass}
            onClick={() => onChange({ kind: 'day', date: shiftDate(view.date, -1) })}
          >
            ← Prev
          </button>
          <button
            type="button"
            className={formButtonClass}
            disabled={view.date === today}
            onClick={() => onChange({ kind: 'day', date: today })}
          >
            Today
          </button>
          <button
            type="button"
            className={formButtonClass}
            onClick={() => onChange({ kind: 'day', date: shiftDate(view.date, 1) })}
          >
            Next →
          </button>
          <label className="sr-only" htmlFor="floor-date">
            Date
          </label>
          <input
            id="floor-date"
            type="date"
            className={`${compactInputClass} w-auto`}
            value={view.date}
            onChange={(e) => {
              if (DATE_RE.test(e.target.value)) onChange({ kind: 'day', date: e.target.value });
            }}
          />
          <span className="font-mono text-xs text-white/45">{formatDateLabel(view.date)}</span>
        </div>
      )}

      {range && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="floor-from">
            From
          </label>
          <input
            id="floor-from"
            type="datetime-local"
            className={`${compactInputClass} w-auto`}
            value={range.from}
            onChange={(e) => editRange({ ...range, from: e.target.value })}
          />
          <span className="font-mono text-xs text-white/40">to</span>
          <label className="sr-only" htmlFor="floor-to">
            To
          </label>
          <input
            id="floor-to"
            type="datetime-local"
            className={`${compactInputClass} w-auto`}
            value={range.to}
            onChange={(e) => editRange({ ...range, to: e.target.value })}
          />
          {rangeError && (
            <span className="font-mono text-xs text-[var(--pyre-gold)]">{rangeError}</span>
          )}
        </div>
      )}
    </div>
  );
}
