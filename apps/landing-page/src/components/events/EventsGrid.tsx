// Date-grouped schedule view for the events page.
// Shows only sessions within the next 2 weeks and filters them by session type
// (derived dynamically from the Momence tags present on those upcoming events).

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useEvents } from '@/hooks/useEvents';
import { trackBookingLinkClicked } from '@/lib/analytics';
import {
  bookedFromSpots,
  computeHourlyOccupancy,
  maxOccupancyForLocation,
  OPEN_HOURS_TAG,
  poolSpotsLeftForSlot,
} from '@/lib/capacity';
import { creditsForPriceUsd } from '@/lib/credits';
import {
  ALL_TYPES_FILTER,
  ALL_TYPES_LABEL,
  CATEGORY_TAGS,
  isSpecialEvent,
  WINDOW_DAYS,
} from '@/lib/events-config';
import type { EventItem, OpenHoursBookingOption } from '@/lib/types';

const EventDetailModal = lazy(() => import('./EventDetailModal'));

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
    <div className="space-y-8 text-[var(--pyre-creme)]">
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
          No sessions of this type in the next two weeks
        </h2>
        <p className="font-sans text-base text-[var(--pyre-creme)]/70">
          Try a different session type to see more upcoming sessions.
        </p>
        <button
          type="button"
          onClick={onShowAll}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--pyre-burnt-orange)] px-6 py-3 font-mono text-sm font-bold uppercase tracking-wide text-[var(--pyre-red)] transition-colors hover:bg-[var(--pyre-burnt-orange)]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pyre-burnt-orange)] focus-visible:ring-offset-2"
        >
          Show All Types
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
        <span className="font-mono-bold text-sm uppercase tracking-wide text-[var(--pyre-creme)] flex items-center justify-between sm:justify-start sm:w-72 shrink-0">
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
      <span className="font-mono-bold text-sm uppercase tracking-wide text-[var(--pyre-creme)] flex items-center justify-between sm:justify-start sm:w-72 shrink-0">
        <span className="truncate">{event.title}</span>
        {/* Mobile-only CTA pill */}
        <a
          href={event.cta?.href ?? '#'}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={event.cta?.ariaLabel ?? `Book ${event.title}`}
          onClick={(e) => {
            e.stopPropagation();
            trackBookingLinkClicked(event, 'events_grid_mobile');
          }}
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
        onClick={(e) => {
          e.stopPropagation();
          trackBookingLinkClicked(event, 'events_grid_desktop');
        }}
        className="hidden sm:inline-flex items-center text-sm font-mono-bold uppercase tracking-wide bg-[var(--pyre-red)] rounded-full px-4 py-1.5 text-[var(--pyre-creme)] hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
      >
        {ctaLabel}
        <ArrowIcon />
      </a>
    </div>
  );
}

// -- Open Hours: hourly schedule + in-modal 1hr / 2hr booking -----------------
//
// The schedule shows only 1-hour Open Hours slots. A matching 2-hour session
// (same start + location) is kept in Momence but hidden from the schedule; it
// surfaces as the "Book 2 hours" option in the details modal so the whole
// 2-hour visit stays a single Momence checkout. Standalone 2-hour Open Hours
// sessions (no 1-hour counterpart) still render as their own row. Every option
// is gated by the shared occupancy pool AND its own Momence capacity.

const TWO_HOUR_MIN_MINUTES = 90;

function isOpenHours(event: EventItem): boolean {
  return !event.isPrivate && eventHasTag(event, OPEN_HOURS_TAG);
}
function isTwoHourOpenHours(event: EventItem): boolean {
  return isOpenHours(event) && (event.durationMinutes ?? 0) >= TWO_HOUR_MIN_MINUTES;
}
function isOneHourOpenHours(event: EventItem): boolean {
  const minutes = event.durationMinutes ?? 0;
  return isOpenHours(event) && minutes > 0 && minutes < TWO_HOUR_MIN_MINUTES;
}
function openHoursStartKey(event: EventItem): string {
  return `${event.location}__${event.isoDate ?? event.id}`;
}
function durationLabel(minutes: number): string {
  if (!minutes) return 'Session';
  if (minutes === 60) return '1 hour';
  if (minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} min`;
}

function gatedSpotsLeft(event: EventItem, occupancy: Map<string, number>): number {
  const pool = poolSpotsLeftForSlot(event, occupancy, maxOccupancyForLocation(event.location));
  const sessionRemaining = event.spotsRemaining ?? Number.POSITIVE_INFINITY;
  return Math.max(0, Math.min(pool, sessionRemaining));
}
function toBookingOption(event: EventItem, occupancy: Map<string, number>): OpenHoursBookingOption {
  const minutes = event.durationMinutes ?? 0;
  const spotsLeft = gatedSpotsLeft(event, occupancy);
  // Credit cost comes from the Momence drop-in price; fall back to 1 credit per
  // hour only when the price is missing.
  const credits = creditsForPriceUsd(event.priceUsd) ?? Math.max(1, Math.round(minutes / 60));
  return {
    label: `Book ${durationLabel(minutes)}`,
    minutes,
    href: event.cta?.href ?? '#',
    spotsLeft,
    soldOut: spotsLeft <= 0,
    credits,
    priceUsd: event.priceUsd,
  };
}

interface OpenHoursModel {
  // Booking options for each *displayed* Open Hours event, keyed by event id.
  optionsById: Map<string, OpenHoursBookingOption[]>;
  // 2-hour sessions hidden from the schedule (they back a 1-hour slot's option).
  hiddenIds: Set<string>;
}

function buildOpenHoursModel(events: EventItem[]): OpenHoursModel {
  const openHours = events.filter(isOpenHours);

  const occupancy = computeHourlyOccupancy(
    openHours.map((e) => ({
      isoDate: e.isoDate,
      durationMinutes: e.durationMinutes,
      location: e.location,
      booked: bookedFromSpots(e.totalSpots, e.spotsRemaining),
    }))
  );

  const twoHourByStart = new Map<string, EventItem>();
  const oneHourStarts = new Set<string>();
  for (const e of openHours) {
    if (isTwoHourOpenHours(e)) twoHourByStart.set(openHoursStartKey(e), e);
    else if (isOneHourOpenHours(e)) oneHourStarts.add(openHoursStartKey(e));
  }

  // Hide a 2-hour session when a 1-hour slot shares its start — it becomes that
  // slot's "Book 2 hours" option instead of its own row.
  const hiddenIds = new Set<string>();
  for (const e of openHours) {
    if (isTwoHourOpenHours(e) && oneHourStarts.has(openHoursStartKey(e))) hiddenIds.add(e.id);
  }

  const optionsById = new Map<string, OpenHoursBookingOption[]>();
  for (const e of openHours) {
    if (hiddenIds.has(e.id)) continue;
    if (isOneHourOpenHours(e)) {
      const partner = twoHourByStart.get(openHoursStartKey(e));
      const twoHourOption: OpenHoursBookingOption = partner
        ? toBookingOption(partner, occupancy)
        : {
            label: 'Book 2 hours',
            minutes: 120,
            href: '#',
            spotsLeft: 0,
            soldOut: true,
            credits: 2,
          };
      optionsById.set(e.id, [toBookingOption(e, occupancy), twoHourOption]);
    } else {
      // Standalone 2-hour (or odd-duration) Open Hours session — single option.
      optionsById.set(e.id, [toBookingOption(e, occupancy)]);
    }
  }

  return { optionsById, hiddenIds };
}

function OpenHoursRow({
  event,
  options,
  onViewDetails,
}: {
  event: EventItem;
  options: OpenHoursBookingOption[];
  onViewDetails: (event: EventItem) => void;
}) {
  const rowSpots = options.length ? Math.max(...options.map((o) => o.spotsLeft)) : 0;
  const allSoldOut = options.length > 0 && options.every((o) => o.soldOut);
  const spotsText = allSoldOut ? 'Waitlist' : `${rowSpots} left`;

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
      <span className="font-mono-bold text-sm uppercase tracking-wide text-[var(--pyre-creme)] flex items-center justify-between sm:justify-start sm:w-72 shrink-0">
        <span className="truncate">{event.title}</span>
        {/* Mobile book pill — opens the modal to choose duration */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onViewDetails(event);
          }}
          className="sm:hidden inline-flex items-center text-xs font-mono-bold uppercase tracking-wide bg-[var(--pyre-red)] rounded-full px-3 py-1 text-[var(--pyre-creme)] hover:opacity-90 transition-opacity whitespace-nowrap ml-2"
        >
          Book
          <ArrowIcon />
        </button>
      </span>

      {/* Time */}
      <span className="flex items-center text-sm text-[var(--pyre-creme)]/70 sm:flex-1">
        <span className="inline-flex items-center gap-1.5">
          <ClockIcon className="w-3.5 h-3.5" />
          {event.time}
        </span>
      </span>

      {/* Spots (desktop) */}
      <span
        className={`hidden sm:inline-flex items-center gap-1.5 text-sm shrink-0 ${spotsColor(allSoldOut ? 0 : rowSpots)}`}
      >
        <UsersIcon className="w-3.5 h-3.5" />
        {spotsText}
      </span>
      {/* Spots (mobile) */}
      <span
        className={`sm:hidden inline-flex items-center gap-1.5 text-sm ${spotsColor(allSoldOut ? 0 : rowSpots)}`}
      >
        <UsersIcon className="w-3.5 h-3.5" />
        {spotsText}
      </span>

      {/* Book pill (desktop) — opens the modal to choose duration */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onViewDetails(event);
        }}
        className="hidden sm:inline-flex items-center text-sm font-mono-bold uppercase tracking-wide bg-[var(--pyre-red)] rounded-full px-4 py-1.5 text-[var(--pyre-creme)] hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
      >
        Book
        <ArrowIcon />
      </button>
    </div>
  );
}

function DateGroup({
  dateLabel,
  events,
  optionsById,
  onViewDetails,
}: {
  dateLabel: string;
  events: EventItem[];
  optionsById: Map<string, OpenHoursBookingOption[]>;
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
        {events.map((event) => {
          const options = optionsById.get(event.id);
          return options ? (
            <OpenHoursRow
              key={event.id}
              event={event}
              options={options}
              onViewDetails={onViewDetails}
            />
          ) : (
            <SlotRow key={event.id} event={event} onViewDetails={onViewDetails} />
          );
        })}
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

// -- Window + type filter logic ----------------------------------------------

// Keep only events that fall within the next WINDOW_DAYS (the hard 2-week limit).
// Special events are exempt: any published special event shows regardless of how
// far out it is.
function filterEventsByWindow(events: EventItem[]): EventItem[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const endDate = new Date(now);
  endDate.setDate(now.getDate() + WINDOW_DAYS);
  endDate.setHours(23, 59, 59, 999);

  return events.filter((event) => {
    if (!event.isoDate) return true;
    if (isSpecialEvent(event)) return true;
    const eventDate = new Date(event.isoDate);
    return eventDate >= now && eventDate <= endDate;
  });
}

// The allowlisted category tags (in display order) that have at least one event
// in the window. Tags on events are matched case-insensitively.
function deriveTypeFilters(events: EventItem[]): string[] {
  const present = new Set<string>();
  for (const event of events) {
    if (!Array.isArray(event.tags)) continue;
    for (const tag of event.tags) {
      present.add(tag.trim().toLowerCase());
    }
  }
  return CATEGORY_TAGS.filter((category) => present.has(category.toLowerCase()));
}

function eventHasTag(event: EventItem, tag: string): boolean {
  if (!Array.isArray(event.tags)) return false;
  const lower = tag.toLowerCase();
  return event.tags.some((t) => t.trim().toLowerCase() === lower);
}

// -- Filter chips ------------------------------------------------------------

const CHIP_CLASSES =
  'inline-flex items-center justify-center select-none font-mono-bold rounded-md font-semibold uppercase tracking-wide transition-colors duration-150 px-4 py-2 text-base btn-cta-animated text-[var(--pyre-creme)]';

function TypeFilter({
  types,
  selected,
  onSelect,
}: {
  types: string[];
  selected: string;
  onSelect: (type: string) => void;
}) {
  const chips = [ALL_TYPES_FILTER, ...types];
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Session type filters">
      {chips.map((type) => {
        const isActive = type === selected;
        const label = type === ALL_TYPES_FILTER ? ALL_TYPES_LABEL : type;
        return (
          <button
            key={type}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(type)}
            className={isActive ? `${CHIP_CLASSES} is-animating` : CHIP_CLASSES}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// -- Main component ----------------------------------------------------------

export default function EventsGrid({ fallback = [] }: EventsGridProps) {
  const { events, loading } = useEvents(fallback);
  const [selectedType, setSelectedType] = useState<string>(ALL_TYPES_FILTER);
  const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null);

  // Remove server-rendered skeleton once React has hydrated
  useEffect(() => {
    document.getElementById('events-skeleton')?.remove();
  }, []);

  // Read the initial type filter from the URL (?type=)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const initialType = urlParams.get('type');
    if (initialType) setSelectedType(initialType);
  }, []);

  const handleSelectType = useCallback((type: string) => {
    setSelectedType(type);
    const url = new URL(window.location.href);
    if (type === ALL_TYPES_FILTER) {
      url.searchParams.delete('type');
    } else {
      url.searchParams.set('type', type);
    }
    window.history.replaceState({}, '', url.toString());
  }, []);

  const handleShowAll = useCallback(() => handleSelectType(ALL_TYPES_FILTER), [handleSelectType]);

  // Open modal for event specified in ?event= query param (deep-link from carousel).
  // Matched against the full fetched list so links to events >2 weeks out still open.
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

  // Hard 2-week window — the base set everything else derives from.
  const windowedEvents = useMemo(() => filterEventsByWindow(displayEvents), [displayEvents]);

  // Open Hours model: shared occupancy pool + per-slot 1hr/2hr booking options +
  // the set of 2-hour sessions hidden from the schedule. Built from the full
  // window (not the type-filtered subset) so the cap is correct regardless of
  // which type chip is active.
  const openHoursModel = useMemo(() => buildOpenHoursModel(windowedEvents), [windowedEvents]);

  // Dynamic type chips, built from the tags present on the upcoming events.
  const typeFilters = useMemo(() => deriveTypeFilters(windowedEvents), [windowedEvents]);

  // If the active type isn't available in the current window, fall back to "all".
  const effectiveType =
    selectedType === ALL_TYPES_FILTER ||
    typeFilters.some((t) => t.toLowerCase() === selectedType.toLowerCase())
      ? selectedType
      : ALL_TYPES_FILTER;

  const filteredEvents = useMemo(() => {
    const base =
      effectiveType === ALL_TYPES_FILTER
        ? windowedEvents
        : windowedEvents.filter((event) => eventHasTag(event, effectiveType));
    // Drop the 2-hour sessions that are hidden behind a 1-hour slot's option.
    return base.filter((event) => !openHoursModel.hiddenIds.has(event.id));
  }, [windowedEvents, effectiveType, openHoursModel]);
  const grouped = useMemo(() => groupEventsByDate(filteredEvents), [filteredEvents]);

  const visibleCount = filteredEvents.length;
  const totalCount = windowedEvents.length - openHoursModel.hiddenIds.size;

  // Update the results count in the DOM (for the Astro-rendered count element)
  useEffect(() => {
    const visibleCountEl = document.getElementById('visible-count');
    const totalCountEl = document.getElementById('total-count');
    if (visibleCountEl) visibleCountEl.textContent = String(visibleCount);
    if (totalCountEl) totalCountEl.textContent = String(totalCount);
  }, [visibleCount, totalCount]);

  if (loading) {
    return <ScheduleSkeleton />;
  }

  if (windowedEvents.length === 0) {
    return <NoEventsMessage />;
  }

  return (
    <>
      {/* Only show the filter row when there's more than one type to choose from */}
      {typeFilters.length > 1 && (
        <div className="mb-8">
          <TypeFilter types={typeFilters} selected={effectiveType} onSelect={handleSelectType} />
        </div>
      )}

      {visibleCount === 0 ? (
        <EmptyState onShowAll={handleShowAll} />
      ) : (
        <div className="space-y-2">
          {Array.from(grouped.entries()).map(([dateKey, groupEvents]) => (
            <DateGroup
              key={dateKey}
              dateLabel={groupEvents[0].date}
              events={groupEvents}
              optionsById={openHoursModel.optionsById}
              onViewDetails={setSelectedEvent}
            />
          ))}
        </div>
      )}
      <Suspense fallback={null}>
        <EventDetailModal
          event={selectedEvent}
          isOpen={!!selectedEvent}
          bookingOptions={
            selectedEvent ? openHoursModel.optionsById.get(selectedEvent.id) : undefined
          }
          onClose={() => setSelectedEvent(null)}
        />
      </Suspense>
    </>
  );
}
