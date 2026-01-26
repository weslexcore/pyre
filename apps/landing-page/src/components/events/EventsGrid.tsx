// React grid component for dynamically loaded events on the events page
// Listens for date filter events from the Astro EventDateFilter component

import { useState, useEffect, useCallback } from 'react';
import { useEvents } from '@/hooks/useEvents';
import type { EventItem } from '@/lib/types';

interface EventsGridProps {
  fallback?: EventItem[];
}

function EventCardSkeleton() {
  return (
    <div className="border border-current/20 rounded-lg overflow-hidden bg-[var(--pyre-black)] text-[var(--pyre-creme)] animate-pulse">
      <div className="p-5">
        <div className="mb-4">
          <div className="h-6 w-24 bg-current/10 rounded" />
        </div>
        <div className="h-6 w-full bg-current/10 rounded mb-2" />
        <div className="h-4 w-3/4 bg-current/10 rounded mb-4" />
        <div className="space-y-2 mb-4">
          <div className="h-4 w-32 bg-current/10 rounded" />
          <div className="h-4 w-28 bg-current/10 rounded" />
        </div>
        <div className="h-10 w-full bg-current/10 rounded" />
      </div>
    </div>
  );
}

function EventCard({ event, visible }: { event: EventItem; visible: boolean }) {
  if (!visible) return null;

  return (
    <article
      className="event-card border border-current/20 rounded-lg overflow-hidden bg-[var(--pyre-black)] text-[var(--pyre-creme)] transition-all duration-300 hover:border-current/40 hover:shadow-lg"
      data-iso-date={event.isoDate}
    >
      <div className="p-5">
        <div className="mb-4">
          <span className="inline-block px-2 py-1 text-xs font-mono-bold uppercase tracking-wide bg-[var(--pyre-burnt-orange)]/10 text-[var(--pyre-burnt-orange)] rounded">
            {event.date}
          </span>
        </div>

        <h3 className="font-mono-bold text-lg uppercase tracking-wide mb-2">
          {event.title}
        </h3>

        <p className="text-sm opacity-70 mb-4 line-clamp-2">{event.description}</p>

        <div className="space-y-1 text-sm opacity-70 mb-4">
          <div className="flex items-center gap-2">
            <svg
              className="w-4 h-4 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span>{event.time}</span>
          </div>
          <div className="flex items-center gap-2">
            <svg
              className="w-4 h-4 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <span>{event.location}</span>
          </div>
          {event.spotsRemaining !== undefined && (
            <div className="flex items-center gap-2">
              <svg
                className="w-4 h-4 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
              <span>{event.spotsRemaining} spots left</span>
            </div>
          )}
        </div>

        {event.cta && (
          <a
            href={event.cta.href}
            aria-label={event.cta.ariaLabel}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-current/60 px-4 py-2 font-mono text-sm font-bold uppercase tracking-wide transition-all duration-200 hover:border-current hover:bg-current/5"
          >
            {event.cta.label}
          </a>
        )}
      </div>
    </article>
  );
}

function EmptyState({ onShowAll }: { onShowAll: () => void }) {
  return (
    <div className="text-center py-12">
      <div className="mx-auto max-w-md space-y-4">
        <svg
          className="mx-auto h-16 w-16 text-[var(--pyre-creme)]/20"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <h2 className="font-sans text-xl font-semibold text-[var(--pyre-creme)]">
          No events in this time range
        </h2>
        <p className="font-sans text-base text-[var(--pyre-creme)]/70">
          Try selecting a different filter to see more events.
        </p>
        <button
          type="button"
          onClick={onShowAll}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--pyre-burnt-orange)] px-6 py-3 font-mono text-sm font-bold uppercase tracking-wide text-[var(--pyre-red)] transition-colors hover:bg-[var(--pyre-burnt-orange)]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pyre-burnt-orange)] focus-visible:ring-offset-2"
        >
          Show All Events
        </button>
      </div>
    </div>
  );
}

function NoEventsMessage() {
  return (
    <div className="text-center py-12">
      <p className="font-sans text-lg text-[var(--pyre-creme)]/70">
        No upcoming events at this time. Check back soon!
      </p>
    </div>
  );
}

type FilterType = 'week' | 'month' | '30days' | 'all';

function filterEventsByDateRange(
  events: EventItem[],
  filter: FilterType
): EventItem[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  let endDate: Date;

  switch (filter) {
    case 'week': {
      endDate = new Date(now);
      const daysUntilSunday = 7 - now.getDay();
      endDate.setDate(now.getDate() + daysUntilSunday);
      endDate.setHours(23, 59, 59, 999);
      break;
    }
    case 'month': {
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      endDate.setHours(23, 59, 59, 999);
      break;
    }
    case '30days': {
      endDate = new Date(now);
      endDate.setDate(now.getDate() + 30);
      endDate.setHours(23, 59, 59, 999);
      break;
    }
    default: {
      // 'all' and any other value - no end date limit
      endDate = new Date('2100-01-01');
      break;
    }
  }

  return events.filter((event) => {
    if (!event.isoDate) return true; // Show events without date
    const eventDate = new Date(event.isoDate);
    return eventDate >= now && eventDate <= endDate;
  });
}

export default function EventsGrid({ fallback = [] }: EventsGridProps) {
  const { events, loading } = useEvents(fallback);
  const [filter, setFilter] = useState<FilterType>('all');

  // Listen for filter events from the Astro EventDateFilter component
  useEffect(() => {
    function handleFilterEvent(e: CustomEvent<{ filter: string }>) {
      setFilter(e.detail.filter as FilterType);
    }

    window.addEventListener(
      'event-date-filter',
      handleFilterEvent as EventListener
    );

    // Get initial filter from URL
    const urlParams = new URLSearchParams(window.location.search);
    const initialFilter = urlParams.get('filter') || 'all';
    setFilter(initialFilter as FilterType);

    return () => {
      window.removeEventListener(
        'event-date-filter',
        handleFilterEvent as EventListener
      );
    };
  }, []);

  const handleShowAll = useCallback(() => {
    // Click the "All Upcoming" filter button
    const allFilterBtn = document.querySelector(
      '.filter-btn[data-filter="all"]'
    ) as HTMLButtonElement | null;
    if (allFilterBtn) {
      allFilterBtn.click();
    } else {
      setFilter('all');
    }
  }, []);

  const displayEvents = events.length > 0 ? events : fallback;
  const filteredEvents = filterEventsByDateRange(displayEvents, filter);
  const visibleCount = filteredEvents.length;
  const totalCount = displayEvents.length;

  // Update the results count in the DOM (for the Astro-rendered count element)
  useEffect(() => {
    const visibleCountEl = document.getElementById('visible-count');
    const totalCountEl = document.getElementById('total-count');
    if (visibleCountEl) visibleCountEl.textContent = String(visibleCount);
    if (totalCountEl) totalCountEl.textContent = String(totalCount);
  }, [visibleCount, totalCount]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <EventCardSkeleton key={`skeleton-${i}`} />
        ))}
      </div>
    );
  }

  if (displayEvents.length === 0) {
    return <NoEventsMessage />;
  }

  if (visibleCount === 0) {
    return <EmptyState onShowAll={handleShowAll} />;
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {displayEvents.map((event) => {
          const isVisible = filteredEvents.some((e) => e.id === event.id);
          return <EventCard key={event.id} event={event} visible={isVisible} />;
        })}
      </div>

      <style>{`
        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>
    </>
  );
}
