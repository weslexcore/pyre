// Event detail modal — shows full event info with booking CTA
// Rendered via createPortal to escape Astro layout constraints

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { trackBookingLinkClicked } from '@/lib/analytics';
import type { EventItem, OpenHoursBookingOption } from '@/lib/types';

interface EventDetailModalProps {
  event: EventItem | null;
  isOpen: boolean;
  // When present, the footer shows these gated duration choices (Book 1 hour /
  // Book 2 hours) instead of the single Book Now CTA.
  bookingOptions?: OpenHoursBookingOption[];
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

function ShareIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
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

export default function EventDetailModal({
  event,
  isOpen,
  bookingOptions,
  onClose,
}: EventDetailModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);

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
  // Open Hours sessions surface gated 1hr/2hr choices in the footer; their raw
  // per-session spots are replaced by the per-option "N left" counts.
  const hasBookingOptions = !!bookingOptions && bookingOptions.length > 0;

  // Build a deep-link to this event (with UTM tags) and share via the native
  // share sheet when available, otherwise copy it to the clipboard.
  async function handleShare() {
    if (!event) return;

    const url = new URL(`${window.location.origin}/events`);
    url.searchParams.set('event', event.id);
    url.searchParams.set('utm_source', 'share');
    url.searchParams.set('utm_medium', 'referral');
    url.searchParams.set('utm_campaign', 'event_share');
    url.searchParams.set('utm_content', event.id);
    const shareUrl = url.toString();

    if (navigator.share) {
      try {
        await navigator.share({
          title: event.title,
          text: `Check out ${event.title} at Pyre`,
          url: shareUrl,
        });
      } catch (err) {
        // Ignore user-cancelled shares; surface anything else.
        if ((err as Error)?.name !== 'AbortError') {
          console.error('Share failed:', err);
        }
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  }

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
        className="relative z-10 flex flex-col w-full max-w-lg max-h-[90vh] overflow-hidden rounded-lg border border-[var(--pyre-creme)]/10 bg-[var(--pyre-black)] shadow-2xl"
      >
        {/* Close button */}
        <button
          ref={closeBtnRef}
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="absolute top-3 right-3 z-30 rounded-full border border-[var(--pyre-gold)]/70 bg-black/40 backdrop-blur-sm p-1.5 text-[var(--pyre-creme)] hover:bg-black/60 hover:border-[var(--pyre-gold)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pyre-gold)]/50"
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

        {/* Pinned event image (sits behind the scrolling content) */}
        {event.image && (
          <img
            src={event.image.src}
            alt={event.image.alt}
            className="absolute top-0 inset-x-0 w-full h-48 sm:h-56 object-cover"
            loading="lazy"
          />
        )}

        {/* Scrollable region — content scrolls up over the pinned image */}
        <div className="relative z-10 flex-1 overflow-y-auto">
          {/* Spacer matching the image height so the content starts flush with the
              image bottom and only overlaps once the user scrolls */}
          {event.image && <div className="h-48 sm:h-56" aria-hidden="true" />}

          {/* Content card */}
          <div className="relative bg-[var(--pyre-black)] rounded-t-2xl px-6 pt-8 pb-6">
            {/* Gradient drop-shadow glow on the top edge as the card slides over the image */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 -top-2 h-5 rounded-[2rem] bg-gradient-to-r from-[var(--pyre-sage)] via-[var(--pyre-gold)] to-[var(--pyre-sage)] opacity-30 blur-2xl"
            />

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

              {/* Spots (hidden for Open Hours — the footer shows per-option counts) */}
              {spots && !hasBookingOptions && (
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
              <p className="mt-5 whitespace-pre-line font-sans text-base leading-relaxed text-[var(--pyre-creme)]/80">
                {event.description}
              </p>
            )}
          </div>
        </div>

        {/* Fixed footer — Share + Book Now stay anchored at the bottom */}
        <div className="relative z-20 flex items-start gap-3 border-t border-[var(--pyre-creme)]/10 bg-[var(--pyre-black)] px-6 py-4">
          {/* Share button */}
          <button
            type="button"
            onClick={handleShare}
            aria-label="Share this event"
            className={`inline-flex items-center justify-center gap-2 rounded-full border border-[var(--pyre-creme)]/25 px-4 py-3 font-mono-bold text-sm uppercase tracking-wide text-[var(--pyre-creme)] transition-colors hover:bg-[var(--pyre-creme)]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pyre-gold)]/50 ${!event.isPrivate && event.cta ? 'shrink-0' : 'w-full'}`}
          >
            {copied ? <CheckIcon /> : <ShareIcon />}
            {copied ? 'Copied!' : 'Share'}
          </button>

          {/* Booking CTAs */}
          {hasBookingOptions ? (
            // Open Hours: gated 1hr / 2hr choices, with the spots count beneath
            // each button (grayed out when unavailable)
            <div className="flex flex-1 flex-col gap-1.5">
              <div className="flex gap-2">
                {bookingOptions?.map((option) =>
                  option.soldOut ? (
                    <span
                      key={option.minutes}
                      aria-disabled="true"
                      title="Not available"
                      className="flex flex-1 items-center justify-center rounded-full border border-[var(--pyre-creme)]/15 px-4 py-3 font-mono-bold text-sm uppercase tracking-wide text-[var(--pyre-creme)]/35 cursor-not-allowed"
                    >
                      {option.label}
                    </span>
                  ) : (
                    <a
                      key={option.minutes}
                      href={option.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${option.label} — ${event.title}`}
                      onClick={() =>
                        trackBookingLinkClicked(event, `event_detail_modal_${option.minutes}min`)
                      }
                      className="flex flex-1 items-center justify-center rounded-full bg-[var(--pyre-red)] px-4 py-3 font-mono-bold text-sm uppercase tracking-wide text-[var(--pyre-creme)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pyre-red)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pyre-black)]"
                    >
                      {option.label}
                      <ArrowIcon />
                    </a>
                  )
                )}
              </div>
              {/* Spots count row — aligned under each button */}
              <div className="flex gap-2">
                {bookingOptions?.map((option) => (
                  <span
                    key={option.minutes}
                    className={`flex-1 text-center text-[11px] ${option.soldOut ? 'text-[var(--pyre-creme)]/40' : spotsColor(option.spotsLeft)}`}
                  >
                    {option.soldOut ? 'Unavailable' : `${option.spotsLeft} left`}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            !event.isPrivate &&
            event.cta && (
              <a
                href={event.cta.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={event.cta.ariaLabel ?? `Book ${event.title}`}
                onClick={() => trackBookingLinkClicked(event, 'event_detail_modal')}
                className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[var(--pyre-red)] px-6 py-3 font-mono-bold text-sm uppercase tracking-wide text-[var(--pyre-creme)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pyre-red)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pyre-black)]"
              >
                {ctaLabel}
                <ArrowIcon />
              </a>
            )
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
