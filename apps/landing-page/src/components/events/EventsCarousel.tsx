// React carousel component for dynamically loaded events
// Used as an Astro island with client:load directive

import { useCallback, useEffect, useRef, useState } from 'react';
import { useEvents } from '@/hooks/useEvents';
import type { EventItem } from '@/lib/types';

type CarouselVariant = 'default' | 'compact';

interface EmptyStateConfig {
  message: string;
  cta?: {
    label: string;
    href: string;
    ariaLabel?: string;
  };
}

interface EventsCarouselProps {
  fallback?: EventItem[];
  variant?: CarouselVariant;
  emptyState?: EmptyStateConfig;
}

const variantStyles = {
  default: {
    card: 'w-[280px] md:w-[320px] bg-[var(--background)]',
    arrow: 'bg-[var(--background)]',
    container: '-mx-4 px-4 md:-mx-8 md:px-8',
    gap: 'gap-4 md:gap-6',
    cardWidth: 320 + 24,
  },
  compact: {
    card: 'w-[280px] md:w-[300px] bg-[var(--pyre-black)]',
    arrow: 'bg-[var(--pyre-black)]',
    container: '-mx-4 px-4 md:-mx-6 md:px-6',
    gap: 'gap-4',
    cardWidth: 300 + 16,
  },
};

function EventCardSkeleton({ variant = 'default' }: { variant?: CarouselVariant }) {
  const styles = variantStyles[variant];
  return (
    <div
      className={`flex-shrink-0 ${styles.card} snap-start border border-current/20 rounded-lg overflow-hidden animate-pulse`}
    >
      <div className="w-full h-36 bg-current/10" />
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

function EventCardContent({
  event,
  styles,
}: {
  event: EventItem;
  styles: (typeof variantStyles)[CarouselVariant];
}) {
  const spots = spotsLabel(event.spotsRemaining, event.totalSpots);

  return (
    <article
      className={`event-card flex-shrink-0 ${styles.card} snap-start border border-current/20 rounded-lg overflow-hidden transition-all duration-300 hover:border-current/40 hover:shadow-lg`}
    >
      {event.image && (
        <img
          src={event.image.src}
          alt={event.image.alt}
          className="w-full h-36 object-cover"
          loading="lazy"
        />
      )}
      <div className="p-5">
        <div className="mb-4">
          <span className="inline-block px-2 py-1 text-xs font-mono-bold uppercase tracking-wide bg-[var(--pyre-burnt-orange)]/10 text-[var(--pyre-burnt-orange)] rounded">
            {event.date}
          </span>
        </div>

        <h3 className="font-mono-bold text-lg uppercase tracking-wide mb-2">{event.title}</h3>

        <p className="text-sm opacity-70 mb-4 line-clamp-2">{event.description}</p>

        <div className="space-y-1 text-sm opacity-70 mb-4">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          {spots && (
            <div className={`flex items-center gap-2 ${spotsColor(event.spotsRemaining)}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
              <span>{spots}</span>
            </div>
          )}
        </div>

        {event.cta && (
          <span className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-current/60 px-4 py-2 font-mono text-sm font-bold uppercase tracking-wide transition-all duration-200 group-hover:border-current group-hover:bg-current/5">
            {event.spotsRemaining === 0 ? 'Join Waitlist' : event.cta.label}
          </span>
        )}
      </div>
    </article>
  );
}

function EventCard({
  event,
  variant = 'default',
}: {
  event: EventItem;
  variant?: CarouselVariant;
}) {
  const styles = variantStyles[variant];

  if (event.cta?.href) {
    return (
      <a
        href={`/events?event=${encodeURIComponent(event.id)}`}
        aria-label={event.cta.ariaLabel}
        className="group cursor-pointer"
      >
        <EventCardContent event={event} styles={styles} />
      </a>
    );
  }

  return <EventCardContent event={event} styles={styles} />;
}

function EmptyEventsState({
  config,
  variant = 'default',
}: {
  config: EmptyStateConfig;
  variant?: CarouselVariant;
}) {
  const styles = variantStyles[variant];
  return (
    <div className="flex justify-center">
      <div
        className={`flex flex-col items-center justify-center text-center py-12 px-6 ${styles.card} border border-current/20 rounded-lg`}
      >
        {/* Calendar icon */}
        <svg
          className="w-12 h-12 mb-4 opacity-40"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>

        <p className="font-mono-bold text-lg uppercase tracking-wide mb-6 opacity-70">
          {config.message}
        </p>

        {config.cta && (
          <a
            href={config.cta.href}
            aria-label={config.cta.ariaLabel}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-current/60 px-6 py-3 font-mono text-sm font-bold uppercase tracking-wide transition-all duration-200 hover:border-current hover:bg-current/5"
          >
            {config.cta.label}
          </a>
        )}
      </div>
    </div>
  );
}

export default function EventsCarousel({
  fallback = [],
  variant = 'default',
  emptyState,
}: EventsCarouselProps) {
  const { events, loading } = useEvents(fallback);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const styles = variantStyles[variant];

  const displayEvents = events.length > 0 ? events : fallback;
  const isEmpty = !loading && displayEvents.length === 0;

  // Dispatch custom event when empty state changes so Astro can hide the default CTA
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('events-empty-state', { detail: { isEmpty } }));
  }, [isEmpty]);

  const updateArrows = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;

    const { scrollLeft, scrollWidth, clientWidth } = container;
    setCanScrollLeft(scrollLeft > 10);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 10);
  }, []);

  const scroll = useCallback(
    (direction: number) => {
      const container = scrollRef.current;
      if (!container) return;

      container.scrollBy({
        left: direction * styles.cardWidth,
        behavior: 'smooth',
      });
    },
    [styles.cardWidth]
  );

  useEffect(() => {
    updateArrows();
    window.addEventListener('resize', updateArrows, { passive: true });
    return () => window.removeEventListener('resize', updateArrows);
  }, [updateArrows]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: events triggers arrow update when loaded
  useEffect(() => {
    updateArrows();
  }, [events, updateArrows]);

  // Show empty state when no events and emptyState config is provided
  if (isEmpty && emptyState) {
    return <EmptyEventsState config={emptyState} variant={variant} />;
  }

  return (
    <div className="events-wrapper relative">
      {/* Left scroll arrow */}
      <button
        type="button"
        onClick={() => scroll(-1)}
        className={`absolute left-0 md:-left-6 top-1/2 -translate-y-1/2 z-10 w-10 h-10 md:w-12 md:h-12 flex items-center justify-center ${styles.arrow} border border-current/20 rounded-full shadow-lg transition-all duration-300 hover:border-current/40 hover:scale-110 ${
          canScrollLeft ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-label="Scroll left"
      >
        <svg
          className="w-5 h-5 md:w-6 md:h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Right scroll arrow */}
      <button
        type="button"
        onClick={() => scroll(1)}
        className={`absolute right-0 md:-right-6 top-1/2 -translate-y-1/2 z-10 w-10 h-10 md:w-12 md:h-12 flex items-center justify-center ${styles.arrow} border border-current/20 rounded-full shadow-lg transition-all duration-300 hover:border-current/40 hover:scale-110 ${
          canScrollRight ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-label="Scroll right"
      >
        <svg
          className="w-5 h-5 md:w-6 md:h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      <div className={`events-container ${styles.container}`}>
        <div
          ref={scrollRef}
          onScroll={updateArrows}
          className={`events-scroll flex ${styles.gap} overflow-x-auto snap-x snap-mandatory pb-4`}
          style={{
            msOverflowStyle: 'none',
            scrollbarWidth: 'none',
          }}
        >
          {loading
            ? // Show skeletons while loading
              Array.from({ length: 4 }).map((_, i) => (
                <EventCardSkeleton key={`skeleton-${i}`} variant={variant} />
              ))
            : // Show events
              displayEvents.map((event) => (
                <EventCard key={event.id} event={event} variant={variant} />
              ))}
        </div>
      </div>

      <style>{`
        .events-scroll::-webkit-scrollbar {
          display: none;
        }
        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}
