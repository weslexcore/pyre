// Where links point. Used for the campaign's default destination on the form
// and for the per-link override on the detail page. Events load lazily from
// the admin-gated proxy the first time anyone needs them.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolveDestination } from '@/lib/campaigns/links';
import {
  type BlogPostRef,
  DESTINATION_KINDS,
  type DestinationKind,
  type EventOption,
  type PartnerRef,
} from '@/lib/campaigns/types';
import { inputClass, TileButton } from '../incidentUi';
import { SearchSelect } from '../SearchSelect';
import { smallLabelClass } from './campaignUi';

export interface DestinationValue {
  kind: DestinationKind;
  value: string;
}

/** A list fetched from an admin route the first time something needs it. */
export interface LazyList<T> {
  items: T[] | null;
  loading: boolean;
  error: string | null;
  sessionExpired: boolean;
  load: () => void;
}

export type EventsState = LazyList<EventOption>;

function useLazyList<T>(url: string, pick: (json: unknown) => T[]): LazyList<T> {
  const [items, setItems] = useState<T[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const started = useRef(false);

  const load = useCallback(() => {
    if (started.current) return;
    started.current = true;
    setLoading(true);
    setError(null);
    fetch(url)
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          setSessionExpired(true);
          throw new Error('Session expired');
        }
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        setItems(pick(await res.json()));
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load');
        started.current = false; // allow a retry
      })
      .finally(() => setLoading(false));
  }, [url, pick]);

  return { items, loading, error, sessionExpired, load };
}

const pickEvents = (json: unknown): EventOption[] =>
  (json as { events?: EventOption[] }).events ?? [];
const pickPartners = (json: unknown): PartnerRef[] =>
  (json as { partners?: PartnerRef[] }).partners ?? [];

/** Upcoming events from Momence, fetched once on demand. */
export function useEvents(): EventsState {
  return useLazyList('/api/admin/events', pickEvents);
}

/** Enabled partners from the registry, fetched once on demand. */
export function usePartners(): LazyList<PartnerRef> {
  return useLazyList('/api/admin/campaign-partners', pickPartners);
}

export function eventLabel(event: EventOption): string {
  const when = [event.date, event.time].filter(Boolean).join(' ');
  return when ? `${event.title} (${when})` : event.title;
}

export function DestinationPicker({
  origin,
  blogPosts,
  events,
  value,
  onChange,
  compact = false,
}: {
  origin: string;
  blogPosts: BlogPostRef[];
  events: EventsState;
  value: DestinationValue;
  onChange: (next: DestinationValue) => void;
  /** Smaller tiles for the per-link override panel. */
  compact?: boolean;
}) {
  const partners = usePartners();

  useEffect(() => {
    if (value.kind === 'event') events.load();
    if (value.kind === 'partner') partners.load();
  }, [value.kind, events.load, partners.load]);

  const resolved = useMemo(
    () => resolveDestination(origin, value.kind, value.value),
    [origin, value.kind, value.value]
  );

  const pick = (kind: DestinationKind) => {
    if (kind === value.kind) return;
    // Preselect the first option so a tile click alone yields a working link.
    const first =
      kind === 'blog'
        ? (blogPosts[0]?.slug ?? '')
        : kind === 'event'
          ? (events.items?.[0]?.id ?? '')
          : '';
    onChange({ kind, value: first });
  };

  return (
    <div className="space-y-3">
      <div
        className={`grid gap-2 ${compact ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-7'}`}
      >
        {DESTINATION_KINDS.map((kind) => (
          <TileButton
            key={kind.key}
            selected={value.kind === kind.key}
            label={kind.label}
            hint={compact ? undefined : kind.hint}
            onClick={() => pick(kind.key)}
          />
        ))}
      </div>

      {value.kind === 'event' && (
        <div>
          <label htmlFor="dest-event" className={smallLabelClass}>
            Which event
          </label>
          {events.loading && <p className="font-mono text-xs text-white/40">Loading events…</p>}
          {events.error && !events.sessionExpired && (
            <p className="text-xs text-[var(--pyre-red)]">
              {events.error}{' '}
              <button type="button" className="underline" onClick={events.load}>
                Try again
              </button>
            </p>
          )}
          {events.items && events.items.length === 0 && (
            <p className="text-xs text-white/50">No upcoming events on the site right now.</p>
          )}
          {events.items && events.items.length > 0 && (
            <SearchSelect
              id="dest-event"
              options={events.items.map((event) => ({
                value: event.id,
                label: eventLabel(event),
              }))}
              value={value.value}
              onChange={(id) => onChange({ kind: 'event', value: id })}
              placeholder="Type to find an event"
              emptyText="No upcoming event matches"
            />
          )}
        </div>
      )}

      {value.kind === 'blog' && (
        <div>
          <label htmlFor="dest-blog" className={smallLabelClass}>
            Which post
          </label>
          {blogPosts.length === 0 ? (
            <p className="text-xs text-white/50">
              Could not load the blog list. Try another destination.
            </p>
          ) : (
            <SearchSelect
              id="dest-blog"
              options={blogPosts.map((post) => ({
                value: post.slug,
                label: post.title,
                hint: post.slug,
              }))}
              value={value.value}
              onChange={(slug) => onChange({ kind: 'blog', value: slug })}
              placeholder="Type to find a post"
              emptyText="No post matches"
            />
          )}
        </div>
      )}

      {value.kind === 'partner' && (
        <div>
          <label htmlFor="dest-partner" className={smallLabelClass}>
            Which partner
          </label>
          {partners.loading && <p className="font-mono text-xs text-white/40">Loading partners…</p>}
          {partners.error && !partners.sessionExpired && (
            <p className="text-xs text-[var(--pyre-red)]">
              {partners.error}{' '}
              <button type="button" className="underline" onClick={partners.load}>
                Try again
              </button>
            </p>
          )}
          {partners.items && partners.items.length === 0 && (
            <p className="text-xs text-white/50">No enabled partners in the registry.</p>
          )}
          {partners.items && partners.items.length > 0 && (
            <SearchSelect
              id="dest-partner"
              options={partners.items.map((partner) => ({
                value: partner.slug,
                label: partner.name,
                hint: `/${partner.slug}`,
              }))}
              value={value.value}
              onChange={(slug) => onChange({ kind: 'partner', value: slug })}
              placeholder="Type to find a partner"
              emptyText="No partner matches"
            />
          )}
          <p className="mt-1 text-xs text-white/40">
            Links open pyresauna.com/&lt;partner slug&gt;. The page has to exist on the site first.
          </p>
        </div>
      )}

      {value.kind === 'custom' && (
        <div>
          <label htmlFor="dest-custom" className={smallLabelClass}>
            Web address
          </label>
          <input
            id="dest-custom"
            type="url"
            className={inputClass}
            value={value.value}
            placeholder="https://www.eventbrite.com/e/..."
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => onChange({ kind: 'custom', value: e.target.value })}
          />
          <p className="mt-1 text-xs text-white/40">
            Clicks still go through pyresauna.com first so they are counted, then on to this page.
          </p>
        </div>
      )}

      {value.kind && (
        <p className="font-mono text-xs break-all">
          {resolved.ok ? (
            <>
              <span className="text-white/35">Links open </span>
              <span className="text-white/70">{resolved.url}</span>
            </>
          ) : (
            <span className="text-white/40">{resolved.error}</span>
          )}
        </p>
      )}
    </div>
  );
}
