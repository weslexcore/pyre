// Event detail modal — shows full event info with booking CTA
// Rendered via createPortal to escape Astro layout constraints

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { EventItem } from '@/lib/types';

interface EventDetailModalProps {
  event: EventItem | null;
  isOpen: boolean;
  onClose: () => void;
}

// -- Inline icons (matching EventsGrid style) --------------------------------

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

function MapPinIcon({ className }: { className?: string }) {
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
        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
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

// -- Helpers ------------------------------------------------------------------

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
  if (totalSpots !== undefined) return `${spotsRemaining}/${totalSpots} open`;
  return `${spotsRemaining} open`;
}

// -- Modal component ----------------------------------------------------------

export default function EventDetailModal({ event, isOpen, onClose }: EventDetailModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Body scroll lock + keyboard handling + focus management
  useEffect(() => {
    if (!isOpen) return;

    // Save and lock
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';

    // Focus close button after mount
    requestAnimationFrame(() => {
      closeBtnRef.current?.focus();
    });

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      // Focus trap
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
      // Restore focus
      if (previousFocusRef.current?.focus) {
        previousFocusRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen || !event) return null;

  const spots = spotsLabel(event.spotsRemaining, event.totalSpots);
  const isWaitlist = event.spotsRemaining === 0;
  const ctaLabel = isWaitlist ? 'Join Waitlist' : (event.cta?.label ?? 'Book Now');

  const modal = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="event-detail-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 transition-opacity duration-300"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-[var(--pyre-creme)]/10 bg-[var(--pyre-black)] shadow-2xl"
      >
        {/* Close button */}
        <button
          ref={closeBtnRef}
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="absolute top-3 right-3 z-20 rounded-md p-1.5 text-[var(--pyre-creme)]/60 hover:text-[var(--pyre-creme)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pyre-gold)]/50"
        >
          <svg
            className="size-5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="2"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Event image */}
        {event.image && (
          <img
            src={event.image.src}
            alt={event.image.alt}
            className="w-full h-48 sm:h-56 object-cover rounded-t-lg"
            loading="lazy"
          />
        )}

        {/* Content */}
        <div className="px-6 pt-8 pb-6">
          {/* Title */}
          <h2
            id="event-detail-title"
            className="font-mono-bold text-xl sm:text-2xl uppercase tracking-wide text-[var(--pyre-creme)] pr-8"
          >
            {event.title}
          </h2>

          {/* Details grid */}
          <div className="mt-4 space-y-2">
            {/* Date */}
            <div className="flex items-center gap-2 text-sm text-[var(--pyre-creme)]/70">
              <ClockIcon className="w-4 h-4 flex-shrink-0" />
              <span>{event.date}</span>
            </div>

            {/* Time */}
            <div className="flex items-center gap-2 text-sm text-[var(--pyre-creme)]/70">
              <ClockIcon className="w-4 h-4 flex-shrink-0" />
              <span>{event.time}</span>
            </div>

            {/* Location */}
            <div className="flex items-center gap-2 text-sm text-[var(--pyre-creme)]/70">
              <MapPinIcon className="w-4 h-4 flex-shrink-0" />
              <span>{event.location}</span>
            </div>

            {/* Spots */}
            {spots && (
              <div
                className={`flex items-center gap-2 text-sm ${spotsColor(event.spotsRemaining)}`}
              >
                <UsersIcon className="w-4 h-4 flex-shrink-0" />
                <span>{spots}</span>
              </div>
            )}
          </div>

          {/* Description */}
          {event.description && (
            <p className="mt-5 font-sans text-base leading-relaxed text-[var(--pyre-creme)]/80">
              {event.description}
            </p>
          )}

          {/* Booking CTA */}
          {!event.isPrivate && event.cta && (
            <a
              href={event.cta.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={event.cta.ariaLabel ?? `Book ${event.title}`}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-[var(--pyre-red)] px-6 py-3 font-mono-bold text-sm uppercase tracking-wide text-[var(--pyre-creme)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pyre-red)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pyre-black)]"
            >
              {ctaLabel}
              <ArrowIcon />
            </a>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
