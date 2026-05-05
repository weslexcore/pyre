// Renders volunteer events fetched from /api/volunteer-events as a card grid.
// When zero events are returned, dispatches a `volunteer-events-state` event
// so the surrounding Astro page can swap in a mailing-list signup block.

import { useEffect, useState } from 'react';
import type { EventItem } from '@/lib/types';

interface ApiResponse {
  events: EventItem[];
}

const CACHE_KEY = 'pyre-volunteer-events-cache';
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  events: EventItem[];
  timestamp: number;
}

function readCache(): EventItem[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.timestamp < CACHE_TTL_MS) return entry.events;
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
  return null;
}

function writeCache(events: EventItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: CacheEntry = { events, timestamp: Date.now() };
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // ignore
  }
}

function dispatchEmptyState(isEmpty: boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('volunteer-events-state', { detail: { isEmpty } })
  );
}

function CardSkeleton() {
  return (
    <li className="flex flex-col overflow-hidden border border-current/20 rounded-lg bg-[var(--pyre-creme)]/5 animate-pulse">
      <div className="w-full aspect-[4/3] bg-current/10" />
      <div className="flex flex-col flex-1 p-5 md:p-6 space-y-3">
        <div className="h-3 w-32 bg-current/10 rounded" />
        <div className="h-6 w-3/4 bg-current/10 rounded" />
        <div className="h-3 w-24 bg-current/10 rounded" />
        <div className="h-3 w-full bg-current/10 rounded" />
        <div className="h-3 w-5/6 bg-current/10 rounded" />
      </div>
    </li>
  );
}

function VolunteerCard({ event }: { event: EventItem }) {
  const ctaLabel =
    event.spotsRemaining === 0 ? 'Join Waitlist' : (event.cta?.label ?? 'Sign up');

  return (
    <li className="flex flex-col overflow-hidden border border-current/20 rounded-lg bg-[var(--pyre-creme)]/5 hover:border-[var(--pyre-muted-gold)]/60 transition-colors">
      <div className="relative w-full aspect-[4/3] overflow-hidden bg-[var(--pyre-black)]">
        {event.image ? (
          <img
            src={event.image.src}
            alt={event.image.alt ?? event.title}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[var(--pyre-muted-gold)]/20 to-[var(--pyre-black)]" />
        )}
      </div>
      <div className="flex flex-col flex-1 p-5 md:p-6">
        <p className="font-mono-bold text-xs uppercase tracking-wide opacity-60 mb-2">
          {event.date}
          {event.time ? ` · ${event.time}` : ''}
        </p>
        <h3 className="font-primary-semibold text-xl md:text-2xl tracking-[-0.01em] mb-2">
          {event.title}
        </h3>
        <p className="text-sm opacity-70 mb-3">{event.location}</p>
        {event.description && (
          <p className="text-sm md:text-base opacity-80 leading-relaxed flex-1 line-clamp-4">
            {event.description}
          </p>
        )}

        <div className="mt-5 flex items-center justify-between gap-3">
          {typeof event.spotsRemaining === 'number' && (
            <span className="font-mono text-xs opacity-60">
              {event.spotsRemaining === 0
                ? 'Waitlist'
                : `${event.spotsRemaining} ${event.spotsRemaining === 1 ? 'spot' : 'spots'} left`}
            </span>
          )}
          {event.cta && !event.isPrivate && (
            <a
              href={event.cta.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={event.cta.ariaLabel ?? `Sign up for ${event.title}`}
              className="inline-flex items-center justify-center select-none font-mono-bold rounded-md font-semibold uppercase tracking-wide transition-colors duration-150 px-3 py-2 text-sm border-2 border-transparent bg-[var(--secondary)] text-[var(--secondary-foreground)] hover:opacity-90"
            >
              {ctaLabel}
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

export default function VolunteerEventsGrid() {
  const [events, setEvents] = useState<EventItem[]>(() => readCache() ?? []);
  const [loading, setLoading] = useState<boolean>(() => readCache() === null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch('/api/volunteer-events');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data: ApiResponse = await response.json();
        if (cancelled) return;
        const fetched = data.events ?? [];
        writeCache(fetched);
        setEvents(fetched);
      } catch (err) {
        console.error('[VolunteerEventsGrid] Fetch error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Notify the Astro page whenever the empty state changes so it can show or
  // hide the mailing-list signup block.
  useEffect(() => {
    if (loading) return;
    dispatchEmptyState(events.length === 0);
  }, [loading, events.length]);

  if (loading && events.length === 0) {
    return (
      <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </ul>
    );
  }

  // Empty: render nothing — the Astro page surfaces a mailing-list signup card
  // in response to the `volunteer-events-state` event.
  if (events.length === 0) {
    return null;
  }

  return (
    <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6">
      {events.map((event) => (
        <VolunteerCard key={event.id} event={event} />
      ))}
    </ul>
  );
}
