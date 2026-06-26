import type { WebhookTracer } from '@pyre/webhook-core';
import type { ResolvedSession } from '@/lib/momence-events';
import { captureEvent } from './posthog';

interface BookingMember {
  email: string;
  firstName?: string;
  lastName?: string;
}

interface BookingPayload {
  sessionId: number;
  sessionBookingId: number;
  isLateCancellation?: boolean;
}

/**
 * Send a server-side booking event to PostHog, keyed by the customer's email so
 * it stitches to the same person as the web `Intro Offer Signup` / `Mailing List
 * Signup` (which call `posthog.identify(email)`). This closes the funnel:
 * visit -> /events -> booking_link_clicked -> booking_completed. Campaign
 * attribution comes for free via the person's $initial_utm_* properties.
 *
 * Best-effort: `captureEvent` swallows its own errors.
 */
export async function trackBookingEvent(
  tracer: WebhookTracer,
  event: 'booking_completed' | 'booking_cancelled',
  member: BookingMember,
  session: ResolvedSession | null,
  payload: BookingPayload
): Promise<void> {
  await tracer.span(
    'Track booking event',
    () =>
      captureEvent({
        distinctId: member.email,
        event,
        properties: {
          session_id: payload.sessionId,
          session_booking_id: payload.sessionBookingId,
          session_type: session?.sessionType,
          session_title: session?.title,
          location: session?.location,
          iso_date: session?.isoDate,
          ...(event === 'booking_cancelled' && {
            is_late_cancellation: payload.isLateCancellation ?? false,
          }),
          $set: {
            email: member.email,
            ...(member.firstName ? { first_name: member.firstName } : {}),
            ...(member.lastName ? { last_name: member.lastName } : {}),
          },
        },
      }),
    { event, to: member.email }
  );
}
