import { useEffect, useState } from 'react';
import { MAX_MEASUREMENT_SESSIONS } from '@/lib/campaigns/event-bookings';
import { inputClass, labelClass } from '../incidentUi';
import { type EventsState, eventLabel } from './DestinationPicker';

export function MeasurementSlots({
  events,
  value,
  onChange,
}: {
  events: EventsState;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  useEffect(() => events.load(), [events.load]);
  const options = (events.items ?? []).map((event) => ({ id: event.id, label: eventLabel(event) }));
  const labels = new Map(options.map((option) => [option.id, option.label]));
  return (
    <section>
      <label htmlFor="measurement-search" className={labelClass}>
        Slots to measure
      </label>
      <p className="mb-2 text-xs text-white/50">
        Count people booked across these slots. This selection does not change where campaign links
        open.
      </p>
      <ul className="mb-2 space-y-1">
        {value.map((id) => (
          <li key={id} className="flex items-center justify-between gap-2 text-sm">
            <span>{labels.get(id) ?? `Slot ${id} (not currently listed)`}</span>
            <button
              type="button"
              className="text-xs underline"
              aria-label={`Remove slot ${id}`}
              onClick={() => onChange(value.filter((item) => item !== id))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <input
        id="measurement-search"
        className={inputClass}
        placeholder="Search slots by title, date or time"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {events.loading && <p className="text-xs text-white/50">Loading slots…</p>}
      {events.error && (
        <p className="text-xs text-[var(--pyre-red)]">
          {events.error}{' '}
          <button type="button" className="underline" onClick={events.load}>
            Try again
          </button>
        </p>
      )}
      <div className="mt-2 max-h-56 overflow-auto space-y-1">
        {options
          .filter(
            (option) =>
              !value.includes(option.id) &&
              option.label.toLowerCase().includes(search.toLowerCase())
          )
          .map((option) => (
            <label key={option.id} className="flex items-center gap-2 text-sm py-1">
              <input
                type="checkbox"
                checked={false}
                disabled={value.length >= MAX_MEASUREMENT_SESSIONS}
                onChange={() => onChange([...value, option.id])}
              />
              {option.label}
            </label>
          ))}
      </div>
      <p className="mt-2 text-xs text-white/40">
        {value.length} of {MAX_MEASUREMENT_SESSIONS} slots selected.{' '}
        {value.length === 0
          ? 'No event totals will be shown.'
          : 'New slots must be added here to include them.'}
      </p>
    </section>
  );
}
