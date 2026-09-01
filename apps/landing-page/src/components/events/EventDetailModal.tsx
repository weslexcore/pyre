// Event detail modal — shows full event info with booking CTA
// Rendered via createPortal to escape Astro layout constraints

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { trackBookingLinkClicked } from '@/lib/analytics';
import { creditsForPriceUsd } from '@/lib/credits';
import { specialEventPractitioners } from '@/lib/practitioners';
import type { EventItem, PooledBookingOption, Practitioner } from '@/lib/types';
import PractitionerByline from './PractitionerByline';

interface EventDetailModalProps {
  event: EventItem | null;
  isOpen: boolean;
  // When present, the footer shows these gated duration choices (e.g. Book 1
  // hour / 2 hours / 3 hours / 4 hours, or Book 3 hours for a social evening)
  // instead of the single Book Now CTA — one row per option.
  bookingOptions?: PooledBookingOption[];
  // Opens the practitioner bio modal (owned by the parent so it can layer on
  // top of this one).
  onOpenPractitioner?: (practitioner: Practitioner) => void;
  // True while the bio modal is stacked on top — this modal then hands Escape
  // and the focus trap over to it.
  keyboardPaused?: boolean;
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

// Duration-only label for a booking row, e.g. "1 Hour" / "2 Hours". Non-whole
// hours fall back to a minutes label, then to stripping the "Book " prefix from
// the option label when the duration is unknown.
function durationRowLabel(minutes: number, fallbackLabel = ''): string {
  if (minutes > 0 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} Hour${hours > 1 ? 's' : ''}`;
  }
  if (minutes > 0) return `${minutes} Min`;
  return fallbackLabel.replace(/^Book\s+/i, '');
}

// -- Booking row --------------------------------------------------------------

// The action shown at the end of a booking row: either a live checkout link or
// a disabled placeholder (e.g. a sold-out duration choice).
type BookingRowAction =
  | { kind: 'link'; href: string; label: string; ariaLabel: string; onClick: () => void }
  | { kind: 'disabled'; label: string };

// A single bookable row: [Duration] [Credits] [slots left] [Book Now]. Shared by
// pooled duration choices and special-event CTAs so they stay identical.
function BookingRow({
  minutes,
  fallbackLabel,
  credits,
  priceUsd,
  spotsLeft,
  action,
}: {
  minutes: number;
  fallbackLabel?: string;
  credits: number | null;
  priceUsd?: number;
  spotsLeft: number | undefined;
  action: BookingRowAction;
}) {
  return (
    <div className="grid grid-cols-[auto_auto_auto_1fr] items-center gap-3 border-t border-[var(--pyre-creme)]/10 py-2.5 first:border-t-0">
      <span className="font-mono-bold text-sm uppercase tracking-wide text-[var(--pyre-creme)] whitespace-nowrap">
        {durationRowLabel(minutes, fallbackLabel)}
      </span>
      <span className="font-mono-bold text-xs uppercase tracking-wide whitespace-nowrap">
        {credits !== null && (
          <span className="text-[var(--pyre-muted-gold)]">
            {credits} Credit{credits > 1 ? 's' : ''}
          </span>
        )}
        {/* {priceUsd !== undefined && priceUsd > 0 && (
          <span className="text-[var(--pyre-creme)]/50">
            {credits !== null ? ' / ' : ''}${priceUsd}
          </span>
        )} */}
      </span>
      <span className={`text-[11px] whitespace-nowrap ${spotsColor(spotsLeft)}`}>
        {spotsLeft !== undefined ? `${spotsLeft} left` : ''}
      </span>
      {action.kind === 'link' ? (
        <a
          href={action.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={action.ariaLabel}
          onClick={action.onClick}
          className="flex items-center justify-center gap-1 justify-self-end rounded-full bg-[var(--pyre-red)] px-4 py-2 font-mono-bold text-xs sm:text-sm uppercase tracking-wide whitespace-nowrap text-[var(--pyre-creme)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pyre-red)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pyre-black)]"
        >
          {action.label}
          <span className="hidden sm:inline-flex items-center">
            <ArrowIcon />
          </span>
        </a>
      ) : (
        <span
          aria-disabled="true"
          title="Not available"
          className="flex items-center justify-center justify-self-end rounded-full border border-[var(--pyre-creme)]/15 px-4 py-2 font-mono-bold text-xs sm:text-sm uppercase tracking-wide whitespace-nowrap text-[var(--pyre-creme)]/35 cursor-not-allowed"
        >
          {action.label}
        </span>
      )}
    </div>
  );
}

// -- Modal component ----------------------------------------------------------

export default function EventDetailModal({
  event,
  isOpen,
  bookingOptions,
  onOpenPractitioner,
  keyboardPaused = false,
  onClose,
}: EventDetailModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  // Read inside the keydown handler so pausing doesn't tear down the effect
  // (which would otherwise re-lock scroll and steal focus back from the bio).
  const keyboardPausedRef = useRef(keyboardPaused);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    keyboardPausedRef.current = keyboardPaused;
  }, [keyboardPaused]);

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
      // The bio modal is stacked above us and owns the keyboard while it's open.
      if (keyboardPausedRef.current) return;

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
  const practitioners = specialEventPractitioners(event);
  const isWaitlist = event.spotsRemaining === 0;
  const ctaLabel = isWaitlist ? 'Join Waitlist' : (event.cta?.label ?? 'Book Now');
  // Pooled sessions surface gated duration choices in the footer; their raw
  // per-session spots are replaced by the per-option "N left" counts.
  const hasBookingOptions = !!bookingOptions && bookingOptions.length > 0;
  // Special (non-pooled) events show their credit cost next to Book Now,
  // derived from the Momence drop-in price when known.
  const specialCredits = hasBookingOptions ? null : creditsForPriceUsd(event.priceUsd);
  // True when the footer renders at least one booking row (pooled choices or
  // a single special-event CTA). Drives the footer and the grid spots fallback.
  const footerHasBookingRow = hasBookingOptions || (!event.isPrivate && !!event.cta);

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

        {/* Share button — mirrors the close button in the top-left corner */}
        <button
          type="button"
          onClick={handleShare}
          aria-label="Share this event"
          title={copied ? 'Copied!' : 'Share'}
          className="font-mono-bold text-sm uppercase items-center gap-1 tracking-wide absolute inline-flex top-3 left-3 z-30 rounded-full border border-[var(--pyre-gold)]/70 bg-black/40 backdrop-blur-sm p-1.5 text-[var(--pyre-creme)] hover:bg-black/60 hover:border-[var(--pyre-gold)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pyre-gold)]/50"
        >
          {copied ? <CheckIcon /> : <ShareIcon />}
          {copied ? 'Copied!' : 'Share'}
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

          {/* No image: reserve space at the top so the Share / close buttons don't overlap the title */}
          {!event.image && <div className="h-12" aria-hidden="true" />}

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

              {/* Spots — hidden whenever a footer booking row already shows the
                  slots-left count (pooled and special events). */}
              {spots && !footerHasBookingRow && (
                <div
                  className={`flex items-center gap-2 text-sm ${spotsColor(event.spotsRemaining)}`}
                >
                  <UsersIcon className="w-4 h-4 flex-shrink-0" />
                  <span>{spots}</span>
                </div>
              )}
            </div>

            {/* Hosted by — guest practitioner(s) on special events. Clicking
                opens their bio when the roster has one. */}
            {practitioners.length > 0 && (
              <div className="mt-5 border-t border-[var(--pyre-creme)]/10 pt-4">
                <PractitionerByline
                  practitioners={practitioners}
                  variant="modal"
                  onOpenBio={onOpenPractitioner}
                />
              </div>
            )}

            {/* Description */}
            {event.description && (
              <p className="mt-5 whitespace-pre-line font-sans text-base leading-relaxed text-[var(--pyre-creme)]/80">
                {event.description}
              </p>
            )}
          </div>
        </div>

        {/* Fixed footer — Book Now stays anchored at the bottom */}
        {footerHasBookingRow && (
          <div className="relative z-20 flex flex-col gap-3 border-t border-[var(--pyre-creme)]/10 bg-[var(--pyre-black)] px-6 py-2">
            {/* Booking CTAs — one shared row layout for every bookable choice:
              [Duration] [Credits] [slots left] [Book Now]. */}
            {hasBookingOptions ? (
              // Pooled sessions: one row per gated duration choice
              // (1hr/2hr/3hr/4hr, 1hr/3hr, ...).
              <div className="flex flex-col">
                {bookingOptions?.map((option) => (
                  <BookingRow
                    key={option.minutes}
                    minutes={option.minutes}
                    fallbackLabel={option.label}
                    credits={option.credits}
                    priceUsd={option.priceUsd}
                    spotsLeft={option.spotsLeft}
                    action={
                      option.soldOut
                        ? { kind: 'disabled', label: 'Sold Out' }
                        : {
                            kind: 'link',
                            href: option.href,
                            label: 'Book Now',
                            ariaLabel: `${option.label} — ${event.title}`,
                            onClick: () =>
                              trackBookingLinkClicked(
                                event,
                                `event_detail_modal_${option.minutes}min`,
                                option.href
                              ),
                          }
                    }
                  />
                ))}
              </div>
            ) : (
              !event.isPrivate &&
              event.cta && (
                <div className="flex flex-col">
                  <BookingRow
                    minutes={event.durationMinutes ?? 0}
                    credits={specialCredits}
                    priceUsd={event.priceUsd}
                    spotsLeft={event.spotsRemaining}
                    action={{
                      kind: 'link',
                      href: event.cta.href,
                      label: ctaLabel,
                      ariaLabel: event.cta.ariaLabel ?? `Book ${event.title}`,
                      onClick: () => trackBookingLinkClicked(event, 'event_detail_modal'),
                    }}
                  />
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
