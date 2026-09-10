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

/** Extract the numeric Momence session id from a checkout href like https://momence.com/s/123456?... */
export function sessionIdFromHref(href: string | undefined): string | null {
  if (!href) return null;
  const match = /\/s\/(\d+)/.exec(href);
  return match ? match[1] : null;
}

/** Extract the catalog membership id from a pack/membership buy link like https://momence.com/m/630916 */
export function membershipIdFromHref(href: string | undefined): string | null {
  if (!href) return null;
  const match = /\/m\/(\d+)/.exec(href);
  return match ? match[1] : null;
}

function capture(event: string, properties: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  const posthog = (
    window as { posthog?: { capture: (e: string, p?: Record<string, unknown>) => void } }
  ).posthog;
  if (!posthog) return;
  try {
    posthog.capture(event, { ...properties, ...getAttribution() });
  } catch {
    // analytics must never break a purchase or booking flow
  }
}

/**
 * Track an outbound click on a Momence pack or membership buy link. The
 * completed purchase arrives server-side from the Momence payment webhook (see
 * apps/integrations), and `membership_id` is the join key for click→purchase
 * attribution inference: the webhook's sale item names the same catalog id as
 * the /m/<id> in the link.
 */
export function trackPurchaseLinkClicked(href: string, placement: string): void {
  capture('purchase_link_clicked', {
    placement,
    membership_id: membershipIdFromHref(href),
    href,
  });
}

/**
 * Track a click on any CTA that carries `data-track-placement`: a Momence
 * checkout link (/s/<session>) is booking intent, a buy link (/m/<membership>)
 * is purchase intent, and anything else is left alone. Used by the shared
 * CtaTracking component.
 */
export function trackCtaLinkClicked(href: string, placement: string): void {
  const sessionId = sessionIdFromHref(href);
  if (sessionId) {
    capture('booking_link_clicked', { placement, session_id: sessionId, href });
    return;
  }
  if (membershipIdFromHref(href)) trackPurchaseLinkClicked(href, placement);
}

/**
 * Track an outbound click on a Momence booking link. This is the "intent" step of the
 * booking funnel; the completed-booking step arrives server-side from the Momence webhook
 * (see apps/integrations). `placement` distinguishes where the CTA was clicked, e.g.
 * 'events_grid_desktop', 'events_grid_mobile', 'event_detail_modal', 'events_carousel'.
 *
 * `session_id` is the join key for click→booking attribution inference (the Momence
 * webhook's payload.sessionId matches the /s/<id> in the checkout URL). Pass `href` when
 * the clicked CTA targets a different session than `event` itself — pooled duration
 * options link to a sibling event's checkout.
 */
export function trackBookingLinkClicked(event: EventItem, placement: string, href?: string): void {
  if (typeof window === 'undefined') return;
  const posthog = (
    window as { posthog?: { capture: (e: string, p?: Record<string, unknown>) => void } }
  ).posthog;
  if (!posthog) return;
  try {
    const effectiveHref = href ?? event.cta?.href;
    posthog.capture('booking_link_clicked', {
      placement,
      session_id: sessionIdFromHref(effectiveHref) ?? event.id,
      session_title: event.title,
      location: event.location,
      iso_date: event.isoDate,
      tags: event.tags,
      spots_remaining: event.spotsRemaining,
      href: effectiveHref,
      ...getAttribution(),
    });
  } catch {
    // analytics must never break the booking flow
  }
}
