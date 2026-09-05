// Finding a guest in Momence by name, for tools that need to reach one.
//
// The incident form has its own richer picker (staff / guest / typed-by-hand,
// with editable fields once chosen), because a report has to be fileable even
// when the person is a passer-by. Lost & Found only ever needs the narrow
// case: this is a member, here is their email. So this is a small field rather
// than a reuse of PersonPicker, sharing the same backing route.
//
// A Momence outage leaves the field disabled with a note rather than blocking
// anything: an item logged without an owner still goes through the session
// blast, which is the common path anyway.

import { type ReactNode, useEffect, useState } from 'react';
import { useCachedJson } from '@/lib/client/cachedJson';
import { buttonClass, inputClass, labelClass } from './incidentUi';

export interface PersonResult {
  memberId: string;
  name: string;
  email: string;
  phone: string;
  detail?: string;
}

interface LookupResponse {
  people: PersonResult[];
  source: 'staff' | 'guest';
  available: boolean;
  error?: string;
}

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

export function useGuestSearch({
  selected,
  onSelect,
}: {
  selected: PersonResult | null;
  onSelect: (person: PersonResult | null) => void;
}): { field: ReactNode } {
  const [query, setQuery] = useState('');
  const settled = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);

  const { data, loading } = useCachedJson<LookupResponse>(
    settled.length >= MIN_QUERY_LENGTH && !selected
      ? `/api/admin/incident-people?source=guest&q=${encodeURIComponent(settled)}`
      : null
  );

  if (selected) {
    return {
      field: (
        <div className="flex items-center justify-between gap-3 rounded border border-white/10 bg-white/5 px-3 py-2.5">
          <span className="min-w-0">
            <span className="block truncate text-sm text-[var(--pyre-creme)]">{selected.name}</span>
            <span className="block truncate font-mono text-xs text-white/45">{selected.email}</span>
          </span>
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              onSelect(null);
              setQuery('');
            }}
          >
            Clear
          </button>
        </div>
      ),
    };
  }

  const results = data?.people ?? [];
  const unavailable = data?.available === false;

  return {
    field: (
      <div>
        <label className={labelClass} htmlFor="guest-search">
          Search guests by name
        </label>
        <input
          id="guest-search"
          className={inputClass}
          value={query}
          placeholder="Start typing a name"
          onChange={(e) => setQuery(e.target.value)}
        />

        {unavailable && (
          <p className="mt-2 text-xs text-white/45">
            {data?.error ??
              'Guest search is unavailable — log it without an owner and use the session blast.'}
          </p>
        )}

        {loading && settled.length >= MIN_QUERY_LENGTH && (
          <p className="mt-2 font-mono text-xs text-white/35">Searching…</p>
        )}

        {!loading && !unavailable && settled.length >= MIN_QUERY_LENGTH && results.length === 0 && (
          <p className="mt-2 text-xs text-white/45">
            Nobody by that name — leave it blank and ask the sessions instead.
          </p>
        )}

        {results.length > 0 && (
          <ul className="mt-2 divide-y divide-white/5 rounded border border-white/10">
            {results.map((person) => (
              <li key={person.memberId}>
                <button
                  type="button"
                  className="w-full px-3 py-2.5 text-left hover:bg-white/5"
                  onClick={() => onSelect(person)}
                  disabled={!person.email}
                >
                  <span className="block text-sm text-[var(--pyre-creme)]">{person.name}</span>
                  <span className="block font-mono text-xs text-white/45">
                    {person.email || 'No email on file — we can’t reach them'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    ),
  };
}
