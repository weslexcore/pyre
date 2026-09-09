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
} from '@/lib/campaigns/types';
import { inputClass, TileButton } from '../incidentUi';
import { smallLabelClass } from './campaignUi';

export interface DestinationValue {
  kind: DestinationKind;
  value: string;
}

export interface EventsState {
  events: EventOption[] | null;
  loading: boolean;
  error: string | null;
  sessionExpired: boolean;
  load: () => void;
}

/** Upcoming events from Momence, fetched once on demand. */
export function useEvents(): EventsState {
  const [events, setEvents] = useState<EventOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const started = useRef(false);

  const load = useCallback(() => {
    if (started.current) return;
    started.current = true;
    setLoading(true);
    setError(null);
    fetch('/api/admin/events')
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          setSessionExpired(true);
          throw new Error('Session expired');
        }
        if (!res.ok) throw new Error(`Failed to load events (${res.status})`);
        const json = (await res.json()) as { events: EventOption[] };
        setEvents(json.events ?? []);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load events');
        started.current = false; // allow a retry
      })
      .finally(() => setLoading(false));
  }, []);

  return { events, loading, error, sessionExpired, load };
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
  useEffect(() => {
    if (value.kind === 'event') events.load();
  }, [value.kind, events.load]);

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
          ? (events.events?.[0]?.id ?? '')
          : '';
    onChange({ kind, value: first });
  };

  return (
    <div className="space-y-3">
      <div
        className={`grid gap-2 ${compact ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'}`}
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
          {events.events && events.events.length === 0 && (
            <p className="text-xs text-white/50">No upcoming events on the site right now.</p>
          )}
          {events.events && events.events.length > 0 && (
            <select
              id="dest-event"
              className={inputClass}
              value={value.value}
              onChange={(e) => onChange({ kind: 'event', value: e.target.value })}
            >
              <option value="">Choose an event</option>
              {events.events.map((event) => (
                <option key={event.id} value={event.id}>
                  {eventLabel(event)}
                </option>
              ))}
            </select>
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
            <select
              id="dest-blog"
              className={inputClass}
              value={value.value}
              onChange={(e) => onChange({ kind: 'blog', value: e.target.value })}
            >
              <option value="">Choose a post</option>
              {blogPosts.map((post) => (
                <option key={post.slug} value={post.slug}>
                  {post.title}
                </option>
              ))}
            </select>
          )}
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
