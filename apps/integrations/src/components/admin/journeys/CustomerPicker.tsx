// Find a Momence customer by name or email, as you type — to preview a
// journey email with their real data, or to add them to a journey. Backed
// by the same Momence customer search the incident and Lost & Found forms use
// (/api/admin/incident-people?source=guest), which matches names and emails.

import { useState } from 'react';
import { useCachedJson } from '@/lib/client/cachedJson';
import { useDebounced } from '@/lib/client/useDebounced';
import { buttonClass, compactInputClass, microLabelClass } from './journeyUi';

export interface PickedCustomer {
  memberId: number;
  name: string;
  email: string;
}

interface LookupResponse {
  people: { memberId: string; name: string; email: string }[];
  available: boolean;
  error?: string;
}

const MIN_QUERY_LENGTH = 2;

export function CustomerPicker({
  selected,
  onSelect,
  label = 'Preview as',
  placeholder = 'Sample data - or search a customer by name or email',
  clearLabel = 'Use sample data',
  id = 'journey-preview-customer',
}: {
  selected: PickedCustomer | null;
  onSelect: (customer: PickedCustomer | null) => void;
  label?: string;
  placeholder?: string;
  clearLabel?: string;
  id?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const settled = useDebounced(query.trim(), 300);
  const searching = !selected && settled.length >= MIN_QUERY_LENGTH;
  const { data, loading } = useCachedJson<LookupResponse>(
    searching ? `/api/admin/incident-people?source=guest&q=${encodeURIComponent(settled)}` : null
  );

  if (selected) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={microLabelClass}>{label}</span>
        <span className="min-w-0 flex-1 truncate rounded border border-white/10 bg-white/5 px-2 py-1 text-sm">
          {selected.name}
          <span className="ml-2 font-mono text-xs text-white/45">{selected.email}</span>
        </span>
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            onSelect(null);
            setQuery('');
          }}
        >
          {clearLabel}
        </button>
      </div>
    );
  }

  const people = (data?.people ?? []).filter((p) => p.memberId);

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1.5">
        <label className={microLabelClass} htmlFor={id}>
          {label}
        </label>
        <input
          id={id}
          className={`${compactInputClass} min-w-0 flex-1`}
          placeholder={placeholder}
          value={query}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
        />
      </div>
      {open && searching && (
        <div className="absolute right-0 left-0 z-20 mt-1 max-h-72 overflow-y-auto rounded border border-white/15 bg-[var(--pyre-black)] shadow-xl">
          {loading && (
            <p className="px-3 py-2 font-mono text-xs text-white/40">Searching Momence...</p>
          )}
          {data?.available === false && (
            <p className="px-3 py-2 text-xs text-white/50">
              {data.error ?? 'Customer search is unavailable.'}
            </p>
          )}
          {!loading && data?.available !== false && people.length === 0 && (
            <p className="px-3 py-2 text-xs text-white/50">No customer matches "{settled}".</p>
          )}
          <ul>
            {people.map((p) => (
              <li key={p.memberId}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left hover:bg-white/5"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onSelect({ memberId: Number(p.memberId), name: p.name, email: p.email });
                    setOpen(false);
                  }}
                >
                  <span className="block text-sm text-[var(--pyre-creme)]">{p.name}</span>
                  <span className="block font-mono text-xs text-white/45">{p.email}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
