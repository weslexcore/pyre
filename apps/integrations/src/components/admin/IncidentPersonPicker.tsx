// Naming the people in an incident report.
//
// Typing a guest's name and number from memory, one-handed, while they sit on
// a bench with an ice pack, is how contact details end up wrong — and wrong
// contact details are how follow-up quietly fails. So the form looks people
// up instead: a guest is searched in Momence, a staff member is picked off
// our roster, and anyone else is typed in by hand.
//
// A lookup only ever *prefills* the fields below it. They stay editable, and
// 'other' skips the lookup entirely, so a Momence outage or an unknown
// passer-by can never block a report from being filed.
//
// Used for both the people an incident happened to and the witnesses to it —
// same identity fields, same three sources.

import { useEffect, useMemo, useState } from 'react';
import { useCachedJson } from '@/lib/client/cachedJson';
import { PERSON_ROLE_LABELS, PERSON_ROLES, type PersonIdentity } from '@/lib/incidents/types';
import { FIELD_LIMITS } from '@/lib/incidents/validate';
import { buttonClass, Chip, inputClass, labelClass } from './incidentUi';

/** One row the lookup can drop into a report (mirrors the API's shape). */
export interface PersonResult {
  memberId: string;
  name: string;
  email: string;
  phone: string;
  detail?: string;
}

export interface PeopleLookupResponse {
  people: PersonResult[];
  source: 'staff' | 'guest';
  /** False when the source is unreachable — the form says so and falls back. */
  available: boolean;
  error?: string;
}

/** Momence search fires on a pause in typing, not on every keystroke. */
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

/**
 * The roster, fetched once per page and shared by every picker on it. Goes
 * through the same module-scope cache as the rest of the admin surface, so
 * revisiting the form doesn't refetch it.
 */
export function useStaffRoster(): { staff: PersonResult[]; available: boolean } {
  const { data } = useCachedJson<PeopleLookupResponse>('/api/admin/incident-people?source=staff');
  return { staff: data?.people ?? [], available: data?.available !== false };
}

export function PersonPicker({
  identity,
  staff,
  staffAvailable,
  onChange,
}: {
  identity: PersonIdentity;
  staff: PersonResult[];
  staffAvailable: boolean;
  onChange: (next: Partial<PersonIdentity>) => void;
}) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, SEARCH_DEBOUNCE_MS);

  // Only search while the guest tab is open and there is enough to go on.
  const searchUrl =
    identity.role === 'guest' && debouncedQuery.trim().length >= MIN_QUERY_LENGTH
      ? `/api/admin/incident-people?source=guest&q=${encodeURIComponent(debouncedQuery.trim())}`
      : null;

  const { data: searchData, loading: searching } = useCachedJson<PeopleLookupResponse>(searchUrl);

  const results = searchData?.people ?? [];
  const searchAvailable = searchData?.available !== false;

  const apply = (person: PersonResult) => {
    onChange({
      name: person.name,
      email: person.email,
      phone: person.phone,
      memberId: person.memberId,
    });
    setQuery('');
  };

  // Switching role clears a lookup-sourced identity: a staff member picked by
  // mistake shouldn't leave their email attached to a guest.
  const setRole = (role: PersonIdentity['role']) => {
    if (role === identity.role) return;
    onChange({ role, name: '', email: '', phone: '', memberId: '' });
    setQuery('');
  };

  const staffValue = useMemo(
    () => staff.find((s) => s.name === identity.name)?.name ?? '',
    [staff, identity.name]
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {PERSON_ROLES.map((role) => (
          <Chip
            key={role}
            label={PERSON_ROLE_LABELS[role]}
            selected={identity.role === role}
            onClick={() => setRole(role)}
          />
        ))}
      </div>

      {identity.role === 'guest' && (
        <div>
          {/** biome-ignore lint/a11y/noLabelWithoutControl: label heads the input below */}
          <label className={labelClass}>Find them in Momence</label>
          <input
            className={inputClass}
            placeholder="Search by name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {searchUrl && searching && (
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-white/35">
              Searching…
            </p>
          )}

          {!searchAvailable && (
            <p className="mt-1 text-xs text-[var(--pyre-gold)]">
              {searchData?.error ?? 'Guest search is unavailable — enter their details by hand.'}
            </p>
          )}

          {results.length > 0 && (
            <ul className="mt-2 divide-y divide-white/5 overflow-hidden rounded border border-white/10">
              {results.map((person) => (
                <li key={person.memberId}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left transition-colors hover:bg-white/5"
                    onClick={() => apply(person)}
                  >
                    <span className="block text-sm text-[var(--pyre-creme)]">{person.name}</span>
                    {person.detail && (
                      <span className="block font-mono text-[10px] text-white/40">
                        {person.detail}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {searchUrl && !searching && searchAvailable && results.length === 0 && (
            <p className="mt-1 text-xs text-white/40">
              No match — fill their details in below, or switch to Other.
            </p>
          )}
        </div>
      )}

      {identity.role === 'staff' && (
        <div>
          {/** biome-ignore lint/a11y/noLabelWithoutControl: label heads the select below */}
          <label className={labelClass}>Which staff member</label>
          <select
            className={inputClass}
            value={staffValue}
            onChange={(e) => {
              const person = staff.find((s) => s.name === e.target.value);
              if (person) apply(person);
            }}
          >
            <option value="">Choose someone…</option>
            {staff.map((person) => (
              <option key={person.name} value={person.name}>
                {person.name}
              </option>
            ))}
          </select>
          {!staffAvailable && (
            <p className="mt-1 text-xs text-[var(--pyre-gold)]">
              The roster is unavailable — enter their name by hand.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <input
          className={inputClass}
          placeholder="Full name"
          maxLength={FIELD_LIMITS.personName}
          value={identity.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <input
          className={inputClass}
          type="tel"
          inputMode="tel"
          placeholder="Phone"
          value={identity.phone}
          onChange={(e) => onChange({ phone: e.target.value })}
        />
        <input
          className={inputClass}
          type="email"
          inputMode="email"
          placeholder="Email"
          value={identity.email}
          onChange={(e) => onChange({ email: e.target.value })}
        />
      </div>

      {identity.memberId && (
        <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--pyre-sage)]">
          Linked to Momence member {identity.memberId}
        </p>
      )}
    </div>
  );
}

/**
 * Who else was working. A picker rather than a text field so the names match
 * the roster exactly — these are the people who get asked what they saw.
 */
export function StaffOnShiftPicker({
  selected,
  staff,
  staffAvailable,
  onChange,
}: {
  selected: string[];
  staff: PersonResult[];
  staffAvailable: boolean;
  onChange: (next: string[]) => void;
}) {
  const remaining = staff.filter((s) => !selected.includes(s.name));

  return (
    <div>
      <select
        className={inputClass}
        value=""
        disabled={!staffAvailable}
        onChange={(e) => {
          if (e.target.value) onChange([...selected, e.target.value]);
        }}
      >
        <option value="">
          {remaining.length === 0 ? 'Everyone is added' : 'Add someone who was working…'}
        </option>
        {remaining.map((person) => (
          <option key={person.name} value={person.name}>
            {person.name}
          </option>
        ))}
      </select>

      {!staffAvailable && (
        <p className="mt-1 text-xs text-[var(--pyre-gold)]">
          The roster is unavailable right now — note who was working in the account instead.
        </p>
      )}

      {selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {selected.map((name) => (
            <Chip
              key={name}
              label={`${name} ✕`}
              selected
              onClick={() => onChange(selected.filter((n) => n !== name))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Shared "remove this row" affordance for the people and witness cards. */
export function RowHeader({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <span className="font-mono text-xs uppercase tracking-wide text-white/40">{label}</span>
      <button
        type="button"
        className={buttonClass}
        onClick={onRemove}
        aria-label={`Remove ${label}`}
      >
        Remove
      </button>
    </div>
  );
}
