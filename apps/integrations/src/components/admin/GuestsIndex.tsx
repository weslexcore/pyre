// The guest list (/admin/guests).
//
// Two questions this page answers: "who is this person?" (search, which asks
// our profiles and Momence together so a guest with no profile yet still
// turns up) and "who have we written about lately?" (the recent list, which
// doubles as the way back to a profile you were just on).

import { useEffect, useMemo, useState } from 'react';
import { useCachedJson } from '@/lib/client/cachedJson';
import { timeAgo } from '@/lib/client/relativeTime';
import type { GuestProfileRow } from '@/lib/db';
import type { GuestSearchHit } from '@/pages/api/admin/guests';
import { QuietBadge } from './guestUi';
import { cardClass, inputClass } from './incidentUi';

interface RecentResponse {
  recent: GuestProfileRow[];
  total: number;
  canManage: boolean;
}

interface SearchResponse {
  query: string;
  results: GuestSearchHit[];
  momenceAvailable: boolean;
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

function profileHref(memberId: string, name: string, email: string): string {
  const params = new URLSearchParams();
  if (name) params.set('name', name);
  if (email) params.set('email', email);
  const qs = params.toString();
  return `/admin/guests/${memberId}${qs ? `?${qs}` : ''}`;
}

export function GuestsIndex() {
  const [query, setQuery] = useState('');
  const settled = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const searching = settled.length >= MIN_QUERY_LENGTH;

  const recent = useCachedJson<RecentResponse>('/api/admin/guests');
  const search = useCachedJson<SearchResponse>(
    searching ? `/api/admin/guests?q=${encodeURIComponent(settled)}` : null,
    { maxAgeMs: 60_000 }
  );

  const results = useMemo(() => search.data?.results ?? [], [search.data]);

  return (
    <div className="space-y-6">
      <div>
        <label className="sr-only" htmlFor="guest-search">
          Find a guest
        </label>
        <input
          id="guest-search"
          className={inputClass}
          value={query}
          placeholder="Find a guest by name or email"
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
        <p className="mt-1.5 text-xs text-white/35">
          Searches our profiles and Momence together. Anyone with a Momence account can have a
          profile — open them and start one.
        </p>
      </div>

      {searching && (
        <section className="space-y-3">
          {search.loading && <p className="font-mono text-xs text-white/40">Searching…</p>}
          {search.error && (
            <p className="text-sm text-[var(--pyre-red)]">Search failed: {search.error}</p>
          )}
          {search.data && !search.data.momenceAvailable && (
            <p className="text-xs text-[var(--pyre-gold)]">
              Momence is unreachable — showing only guests who already have a profile.
            </p>
          )}
          {search.data && results.length === 0 && !search.loading && (
            <div className={cardClass}>
              <p className="text-sm text-white/60">Nobody by that name.</p>
            </div>
          )}
          <ul className="grid gap-2 sm:grid-cols-2">
            {results.map((hit) => (
              <li key={hit.memberId}>
                <a
                  href={profileHref(hit.memberId, hit.name, hit.email)}
                  className={`${cardClass} block transition-colors hover:border-white/25`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="truncate text-sm font-primary-semibold text-[var(--pyre-creme)]">
                      {hit.name}
                    </span>
                    {hit.hasProfile ? (
                      <QuietBadge>Profile</QuietBadge>
                    ) : (
                      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-white/30">
                        No profile yet
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-xs text-white/45">
                    {hit.email || 'No email on file'}
                  </span>
                  {hit.summary && (
                    <span className="mt-1.5 block text-xs leading-snug text-white/60">
                      {hit.summary}
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!searching && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-primary-semibold text-[var(--pyre-creme)]">
              Recently updated
            </h2>
            {recent.data && (
              <span className="font-mono text-xs text-white/35">
                {recent.data.total} profile{recent.data.total === 1 ? '' : 's'}
              </span>
            )}
          </div>

          {recent.error && (
            <p className="text-sm text-[var(--pyre-red)]">Couldn't load profiles: {recent.error}</p>
          )}
          {recent.loading && <p className="font-mono text-xs text-white/40">Loading…</p>}

          {recent.data && recent.data.recent.length === 0 && (
            <div className={cardClass}>
              <p className="text-sm text-white/60">
                No profiles yet. Search for a guest above to start the first one — or open{' '}
                <a href="/admin/guests/sessions" className="underline hover:text-white">
                  who's coming
                </a>{' '}
                and start with tonight's sessions.
              </p>
            </div>
          )}

          <ul className="grid gap-2 sm:grid-cols-2">
            {(recent.data?.recent ?? []).map((profile) => (
              <li key={profile.id}>
                <a
                  href={profileHref(
                    profile.momence_member_id,
                    profile.name ?? '',
                    profile.email ?? ''
                  )}
                  className={`${cardClass} block transition-colors hover:border-white/25`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="truncate text-sm font-primary-semibold text-[var(--pyre-creme)]">
                      {profile.name || profile.email || `Member ${profile.momence_member_id}`}
                    </span>
                    <span
                      className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-white/30"
                      title={profile.updated_at}
                    >
                      {timeAgo(profile.updated_at)}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-xs text-white/45">
                    {profile.email || 'No email on file'}
                  </span>
                  {profile.summary && (
                    <span className="mt-1.5 block text-xs leading-snug text-white/60">
                      {profile.summary}
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default GuestsIndex;
