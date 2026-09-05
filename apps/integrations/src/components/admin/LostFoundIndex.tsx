// The lost-and-found log (/admin/lost-found).
//
// What's in the bin right now is the whole question this page answers, so
// that's the default filter and the thumbnails carry it — a wall of photos is
// scannable in a way a list of "black water bottle" rows is not. The
// donation countdown sits on each card because it is the only thing on this
// page with a deadline attached.
//
// Reads go through useCachedJson, so coming back from an item paints the
// last-known list immediately and revalidates behind it.

import { useMemo, useState } from 'react';
import { useCachedJson } from '@/lib/client/cachedJson';
import type { LostFoundItemRow } from '@/lib/db';
import { CLOSED_STATUSES, DONATION_PARTNER, daysUntilDonation } from '@/lib/lost-found/types';
import type { PeopleNames } from '@/lib/sops/names';
import { cardClass, formatDayAndTime, inputClass, primaryButtonClass } from './incidentUi';
import { LostFoundStatusBadge } from './LostFoundStatusBadge';

interface ListResponse {
  items: LostFoundItemRow[];
  photoCounts: Record<string, number>;
  noticeCounts: Record<string, number>;
  /** Item id -> attachment id of its first photo, for the thumbnail. */
  firstPhoto: Record<string, string>;
  people: PeopleNames;
  canManage: boolean;
  self: string;
}

const FILTERS = [
  { key: 'on_hand', label: 'In the bin' },
  { key: 'due_for_donation', label: 'Due for donation' },
  { key: 'claim_pending', label: 'Claimed' },
  { key: 'closed', label: 'Gone' },
  { key: '', label: 'Everything' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

/** How the deadline reads on a card, and whether it should shout. */
function donationNote(item: LostFoundItemRow): { text: string; urgent: boolean } | null {
  if ((CLOSED_STATUSES as readonly string[]).includes(item.status)) return null;
  const days = daysUntilDonation(item.donate_after);
  if (days <= 0) return { text: `Ready for ${DONATION_PARTNER}`, urgent: true };
  if (days === 1) return { text: 'Donated tomorrow', urgent: true };
  if (days <= 7) return { text: `${days} days left`, urgent: true };
  return { text: `${days} days left`, urgent: false };
}

export function LostFoundIndex() {
  const [filter, setFilter] = useState<FilterKey>('on_hand');
  const [search, setSearch] = useState('');

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (filter) params.set('status', filter);
    const qs = params.toString();
    return `/api/admin/lost-found${qs ? `?${qs}` : ''}`;
  }, [filter]);

  const { data, error, loading, refreshing } = useCachedJson<ListResponse>(url);

  const items = useMemo(() => {
    const rows = data?.items ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((item) =>
      [item.title, item.description, item.reference, item.storage_location, item.owner_name]
        .filter(Boolean)
        .some((field) => (field as string).toLowerCase().includes(needle))
    );
  }, [data?.items, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <a href="/admin/lost-found/new" className={primaryButtonClass}>
          Log a found item
        </a>
        {refreshing && <span className="font-mono text-xs text-white/35">Refreshing…</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((option) => (
          <button
            key={option.key || 'all'}
            type="button"
            onClick={() => setFilter(option.key)}
            aria-pressed={filter === option.key}
            className={`rounded-full border px-3 py-1.5 font-mono text-xs transition-colors ${
              filter === option.key
                ? 'border-[var(--pyre-gold)] bg-[var(--pyre-gold)]/15 text-[var(--pyre-gold)]'
                : 'border-white/10 bg-white/5 text-white/60 hover:border-white/30'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <input
        className={inputClass}
        value={search}
        placeholder="Search by item, case number, or where it's kept"
        onChange={(e) => setSearch(e.target.value)}
      />

      {error && <p className="text-sm text-[var(--pyre-red)]">Couldn't load the log: {error}</p>}
      {loading && <p className="font-mono text-xs text-white/40">Loading…</p>}

      {!loading && items.length === 0 && (
        <div className={cardClass}>
          <p className="text-sm text-white/60">
            {search
              ? 'Nothing matches that.'
              : filter === 'on_hand'
                ? 'The bin is empty. Anything you find, log it here.'
                : 'Nothing here.'}
          </p>
        </div>
      )}

      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => {
          const photoId = data?.firstPhoto[item.id];
          const asked = data?.noticeCounts[item.id] ?? 0;
          const note = donationNote(item);
          return (
            <li key={item.id}>
              <a
                href={`/admin/lost-found/${item.id}`}
                className={`${cardClass} flex gap-3 transition-colors hover:border-white/25`}
              >
                {photoId ? (
                  <img
                    src={`/api/admin/lost-found-media?id=${photoId}`}
                    alt=""
                    loading="lazy"
                    className="h-20 w-20 shrink-0 rounded border border-white/10 object-cover"
                  />
                ) : (
                  <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded border border-dashed border-white/15 font-mono text-[10px] uppercase text-white/25">
                    No photo
                  </span>
                )}

                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className="truncate text-sm font-primary-semibold text-[var(--pyre-creme)]">
                      {item.title}
                    </span>
                    <LostFoundStatusBadge status={item.status} />
                  </span>

                  <span className="mt-1 block truncate font-mono text-xs text-white/45">
                    {item.storage_location || 'Not said where'}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-xs text-white/35">
                    Found {formatDayAndTime(item.found_at)}
                  </span>

                  <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wide">
                    <span className="text-white/30">{item.reference}</span>
                    {asked > 0 && <span className="text-white/40">Asked {asked}</span>}
                    {note && (
                      <span className={note.urgent ? 'text-[var(--pyre-red)]' : 'text-white/35'}>
                        {note.text}
                      </span>
                    )}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>

      {data && (
        <p className="text-xs text-white/35">
          Unclaimed items are flagged for {DONATION_PARTNER} after 30 days. Nothing is donated
          automatically — someone marks it done after the drop-off.
        </p>
      )}
    </div>
  );
}

export default LostFoundIndex;
