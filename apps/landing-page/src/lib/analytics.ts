// Client-side analytics helpers shared across the React event-booking components.
//
// PostHog itself is initialized in `src/components/posthog.astro` (production hosts only),
// which also exposes `window.pyreAttribution()` carrying the campaign attribution captured
// from the landing URL. These helpers no-op safely when PostHog isn't present (e.g. local
// dev, preview deploys, or before the SDK has loaded).

import type { EventItem } from '@/lib/types';

type Attribution = Record<string, string>;

/** Campaign attribution (utm_*, referrer) captured at first page load, if available. */
export function getAttribution(): Attribution {
  if (typeof window === 'undefined') return {};
  try {
    const fn = (window as { pyreAttribution?: () => Attribution }).pyreAttribution;
    return fn ? fn() : {};
  } catch {
    return {};
  }
}

/**
 * Track an outbound click on a Momence booking link. This is the "intent" step of the
 * booking funnel; the completed-booking step arrives server-side from the Momence webhook
 * (see apps/integrations). `placement` distinguishes where the CTA was clicked, e.g.
 * 'events_grid_desktop', 'events_grid_mobile', 'event_detail_modal', 'events_carousel'.
 */
export function trackBookingLinkClicked(event: EventItem, placement: string): void {
  if (typeof window === 'undefined') return;
  const posthog = (
    window as { posthog?: { capture: (e: string, p?: Record<string, unknown>) => void } }
  ).posthog;
  if (!posthog) return;
  try {
    posthog.capture('booking_link_clicked', {
      placement,
      session_title: event.title,
      location: event.location,
      iso_date: event.isoDate,
      tags: event.tags,
      spots_remaining: event.spotsRemaining,
      href: event.cta?.href,
      ...getAttribution(),
    });
  } catch {
    // analytics must never break the booking flow
  }
}
