// Date-grouped schedule view for the events page
// Listens for date filter events from the Astro EventDateFilter component

import { useCallback, useEffect, useState } from 'react';
import { useEvents } from '@/hooks/useEvents';
import type { EventItem } from '@/lib/types';
import EventDetailModal from './EventDetailModal';

interface EventsGridProps {
  fallback?: EventItem[];
}

// -- Icons (inline SVGs reused from the previous card layout) ----------------

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? 'w-4 h-4 flex-shrink-0'}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? 'w-4 h-4 flex-shrink-0'}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      className="ml-1.5 w-3 h-3"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17 8l4 4m0 0l-4 4m4-4H3"
      />
    </svg>
  );
}

// -- Sub-components ----------------------------------------------------------

function ScheduleSkeleton() {
  return (
    <div className="space-y-8">
      {Array.from({ length: 3 }).map((_, gi) => (
        <div key={`skel-group-${gi}`}>
          {/* Date header shimmer */}
          <div className="flex items-center gap-4 mb-3">
            <div className="h-4 w-48 bg-current/10 rounded animate-pulse" />
            <div className="flex-1 h-px bg-current/10" />
          </div>
          {/* Slot row shimmers */}
          {Array.from({ length: 2 }).map((_, ri) => (
            <div
              key={`skel-row-${gi}-${ri}`}
              className="flex items-center gap-4 py-3 px-4 animate-pulse"
            >
              <div className="h-4 w-36 bg-current/10 rounded" />
              <div className="flex-1" />
              <div className="h-4 w-32 bg-current/10 rounded" />
              <div className="h-4 w-20 bg-current/10 rounded" />
              <div className="h-7 w-24 bg-current/10 rounded-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
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
          No sessions in this time range
        </h2>
        <p className="font-sans text-base text-[var(--pyre-creme)]/70">
          Try selecting a different filter to see more sessions.
        </p>
        <button
          type="button"
          onClick={onShowAll}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--pyre-burnt-orange)] px-6 py-3 font-mono text-sm font-bold uppercase tracking-wide text-[var(--pyre-red)] transition-colors hover:bg-[var(--pyre-burnt-orange)]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pyre-burnt-orange)] focus-visible:ring-offset-2"
        >
          Show All Sessions
        </button>
      </div>
    </div>
  );
}

function NoEventsMessage() {
  return (
    <div className="text-center py-12">
      <p className="font-sans text-lg text-[var(--pyre-creme)]/70">
        No upcoming sessions at this time. Check back soon!
      </p>
    </div>
  );
}

function spotsColor(spots: number | undefined): string {
  if (spots === undefined) return 'text-[var(--pyre-creme)] opacity-70';
  if (spots === 0) return 'text-[var(--pyre-red)]';
  if (spots <= 3) return 'text-[var(--pyre-gold)]';
  return 'text-[var(--pyre-creme)] opacity-70';
}

function spotsLabel(
  spotsRemaining: number | undefined,
  totalSpots: number | undefined
): string | null {
  if (spotsRemaining === undefined) return null;
  if (spotsRemaining === 0) return 'Waitlist';
  if (totalSpots !== undefined) {
    return `${spotsRemaining}/${totalSpots} open`;
  }
  return `${spotsRemaining} open`;
}

function SlotRow({
  event,
  onViewDetails,
}: {
  event: EventItem;
  onViewDetails: (event: EventItem) => void;
}) {
  const spots = spotsLabel(event.spotsRemaining, event.totalSpots);
  const isWaitlist = event.spotsRemaining === 0;
  const ctaLabel = isWaitlist ? 'Join Waitlist' : (event.cta?.label ?? 'Book Now');

  if (event.isPrivate) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onViewDetails(event)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onViewDetails(event);
          }
        }}
        className="group flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 py-3 px-4 rounded-md border border-transparent cursor-pointer transition-colors hover:border-current/10 hover:bg-current/[0.03]"
      >
        {/* Title */}
        <span className="font-mono-bold text-sm uppercase tracking-wide text-[var(--pyre-creme)] flex items-center justify-between sm:justify-start sm:w-56 shrink-0">
          <span className="truncate">{event.title}</span>
          {/* Mobile-only Private label */}
          <span className="sm:hidden inline-flex items-center text-xs font-mono-bold uppercase tracking-wide border border-current/40 rounded-full px-3 py-1 text-[var(--pyre-creme)]/50 whitespace-nowrap ml-2">
            Private
          </span>
        </span>

        {/* Time */}
        <span className="flex items-center text-sm text-[var(--pyre-creme)]/70 sm:flex-1">
          <span className="inline-flex items-center gap-1.5">
            <ClockIcon className="w-3.5 h-3.5" />
            {event.time}
          </span>
        </span>

        {/* View Details link (desktop) */}
        <span className="hidden sm:inline-flex items-center text-xs font-mono uppercase tracking-wide text-[var(--pyre-creme)]/50 group-hover:text-[var(--pyre-creme)]/80 transition-colors whitespace-nowrap shrink-0">
          View Details
        </span>

        {/* Desktop Private label */}
        <span className="hidden sm:inline-flex items-center text-sm font-mono-bold uppercase tracking-wide border border-current/40 rounded-full px-4 py-1.5 text-[var(--pyre-creme)]/50 whitespace-nowrap shrink-0">
          Private
        </span>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onViewDetails(event)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onViewDetails(event);
        }
      }}
      className="group flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 py-3 px-4 rounded-md border border-transparent cursor-pointer transition-colors hover:border-current/10 hover:bg-current/[0.03]"
    >
      {/* Title */}
      <span className="font-mono-bold text-sm uppercase tracking-wide text-[var(--pyre-creme)] flex items-center justify-between sm:justify-start sm:w-56 shrink-0">
        <span className="truncate">{event.title}</span>
        {/* Mobile-only CTA pill */}
        <a
          href={event.cta?.href ?? '#'}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={event.cta?.ariaLabel ?? `Book ${event.title}`}
          onClick={(e) => e.stopPropagation()}
          className="sm:hidden inline-flex items-center text-xs font-mono-bold uppercase tracking-wide bg-[var(--pyre-red)] rounded-full px-3 py-1 text-[var(--pyre-creme)] hover:opacity-90 transition-opacity whitespace-nowrap ml-2"
        >
          {ctaLabel}
          <ArrowIcon />
        </a>
      </span>

      {/* Time (second line on mobile, inline on desktop) */}
      <span className="flex items-center text-sm text-[var(--pyre-creme)]/70 sm:flex-1">
        <span className="inline-flex items-center gap-1.5">
          <ClockIcon className="w-3.5 h-3.5" />
          {event.time}
        </span>
      </span>

      {/* Spots - to the left of CTA */}
      {spots && (
        <span
          className={`hidden sm:inline-flex items-center gap-1.5 text-sm shrink-0 ${spotsColor(event.spotsRemaining)}`}
        >
          <UsersIcon className="w-3.5 h-3.5" />
          {spots}
        </span>
      )}

      {/* Mobile spots display */}
      {spots && (
        <span
          className={`sm:hidden inline-flex items-center gap-1.5 text-sm ${spotsColor(event.spotsRemaining)}`}
        >
          <UsersIcon className="w-3.5 h-3.5" />
          {spots}
        </span>
      )}

      {/* View Details link (desktop) */}
      <span className="hidden sm:inline-flex items-center text-xs font-mono uppercase tracking-wide text-[var(--pyre-creme)]/50 group-hover:text-[var(--pyre-creme)]/80 transition-colors whitespace-nowrap shrink-0">
        View Details
      </span>

      {/* Desktop CTA pill */}
      <a
        href={event.cta?.href ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={event.cta?.ariaLabel ?? `Book ${event.title}`}
        onClick={(e) => e.stopPropagation()}
        className="hidden sm:inline-flex items-center text-sm font-mono-bold uppercase tracking-wide bg-[var(--pyre-red)] rounded-full px-4 py-1.5 text-[var(--pyre-creme)] hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
      >
        {ctaLabel}
        <ArrowIcon />
      </a>
    </div>
  );
}

function DateGroup({
  dateLabel,
  events,
  onViewDetails,
}: {
  dateLabel: string;
  events: EventItem[];
  onViewDetails: (event: EventItem) => void;
}) {
  return (
    <div className="mb-6">
      {/* Date header */}
      <div className="flex items-center gap-4 mb-1">
        <span className="font-mono-bold text-sm sm:text-base uppercase tracking-widest text-[var(--pyre-muted-gold)] whitespace-nowrap">
          {dateLabel}
        </span>
        <span className="flex-1 h-px bg-[var(--pyre-muted-gold)]/25" />
      </div>

      {/* Slot rows */}
      <div>
        {events.map((event) => (
          <SlotRow key={event.id} event={event} onViewDetails={onViewDetails} />
        ))}
      </div>
    </div>
  );
}

// -- Grouping helper ---------------------------------------------------------

function groupEventsByDate(events: EventItem[]): Map<string, EventItem[]> {
  const groups = new Map<string, EventItem[]>();
  for (const event of events) {
    const key = event.isoDate ? event.isoDate.split('T')[0] : 'unknown';
    const existing = groups.get(key);
    if (existing) {
      existing.push(event);
    } else {
      groups.set(key, [event]);
    }
  }
  return groups;
}

// -- Date filter logic (unchanged) -------------------------------------------

type FilterType = 'week' | 'month' | '30days' | 'all';

function filterEventsByDateRange(events: EventItem[], filter: FilterType): EventItem[] {
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
      endDate = new Date('2100-01-01');
      break;
    }
  }

  return events.filter((event) => {
    if (!event.isoDate) return true;
    const eventDate = new Date(event.isoDate);
    return eventDate >= now && eventDate <= endDate;
  });
}

// -- Main component ----------------------------------------------------------

export default function EventsGrid({ fallback = [] }: EventsGridProps) {
  const { events, loading } = useEvents(fallback);
  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null);

  // Listen for filter events from the Astro EventDateFilter component
  useEffect(() => {
    function handleFilterEvent(e: CustomEvent<{ filter: string }>) {
      setFilter(e.detail.filter as FilterType);
    }

    window.addEventListener('event-date-filter', handleFilterEvent as EventListener);

    const urlParams = new URLSearchParams(window.location.search);
    const initialFilter = urlParams.get('filter') || 'all';
    setFilter(initialFilter as FilterType);

    return () => {
      window.removeEventListener('event-date-filter', handleFilterEvent as EventListener);
    };
  }, []);

  const handleShowAll = useCallback(() => {
    const allFilterBtn = document.querySelector(
      '.filter-btn[data-filter="all"]'
    ) as HTMLButtonElement | null;
    if (allFilterBtn) {
      allFilterBtn.click();
    } else {
      setFilter('all');
    }
  }, []);

  // Open modal for event specified in ?event= query param (deep-link from carousel)
  useEffect(() => {
    if (loading) return;
    const allEvents = events.length > 0 ? events : fallback;
    if (allEvents.length === 0) return;

    const urlParams = new URLSearchParams(window.location.search);
    const eventId = urlParams.get('event');
    if (!eventId) return;

    const match = allEvents.find((e) => e.id === eventId);
    if (match) {
      setSelectedEvent(match);
      // Clean up the URL so refreshing doesn't re-open the modal
      const url = new URL(window.location.href);
      url.searchParams.delete('event');
      window.history.replaceState({}, '', url.toString());
    }
  }, [loading, events, fallback]);

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

  // Tell the Astro filter component which filters have events
  useEffect(() => {
    if (loading) return;
    const filterIds: FilterType[] = ['week', 'month', '30days', 'all'];
    const available = filterIds.filter(
      (id) => id === 'all' || filterEventsByDateRange(displayEvents, id).length > 0
    );
    window.dispatchEvent(new CustomEvent('event-filters-available', { detail: { available } }));
  }, [loading, displayEvents]);

  if (loading) {
    return <ScheduleSkeleton />;
  }

  if (displayEvents.length === 0) {
    return <NoEventsMessage />;
  }

  if (visibleCount === 0) {
    return <EmptyState onShowAll={handleShowAll} />;
  }

  const grouped = groupEventsByDate(filteredEvents);

  return (
    <>
      <div className="space-y-2">
        {Array.from(grouped.entries()).map(([dateKey, groupEvents]) => (
          <DateGroup
            key={dateKey}
            dateLabel={groupEvents[0].date}
            events={groupEvents}
            onViewDetails={setSelectedEvent}
          />
        ))}
      </div>
      <EventDetailModal
        event={selectedEvent}
        isOpen={!!selectedEvent}
        onClose={() => setSelectedEvent(null)}
      />
    </>
  );
}
