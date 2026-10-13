import { createWebhookLogger, type WebhookTracer } from '@pyre/webhook-core';
import type { ConfirmationEmailProps } from '@/emails/types';
import { buildCalendarLinks } from '@/lib/calendar/links';
import { buildArrivalLabel } from '@/lib/email/arrival';
import { getConfirmationContent } from '@/lib/email/confirmation-content';
import { type ResolvedSession, resolveSession } from '@/lib/momence-events';
import { alreadySent, markSent } from '../idempotency';
import { sendTemplate } from '../send';

const log = createWebhookLogger('BookingEmail');

interface BookingEmailArgs {
  sessionId: number;
  sessionBookingId: number;
  member: { email: string; firstName: string };
  /** Pre-resolved session, if the caller already fetched it (avoids a second API call). */
  session?: ResolvedSession | null;
  tracer: WebhookTracer;
}

/**
 * The confirmation email for a `session-booked` event (guided / social /
 * general fallback), idempotent per booking. The send is allowed to throw
 * (Momence then retries). Anything sent after a booking beyond this — a
 * first-timer welcome, follow-ups — is a journey (/admin/journeys).
 */
export async function sendBookingConfirmationEmails({
  sessionId,
  sessionBookingId,
  member,
  session: providedSession,
  tracer,
}: BookingEmailArgs): Promise<void> {
  const session =
    providedSession !== undefined
      ? providedSession
      : await tracer.span('Resolve session', () => resolveSession(sessionId), {
          sessionId,
        });

  const sessionType = session?.sessionType ?? 'unknown';

  const props: ConfirmationEmailProps = {
    firstName: member.firstName || 'there',
    sessionTitle: session?.title ?? 'Your Pyre session',
    dateLabel: session?.dateLabel ?? 'See your account for details',
    timeLabel: session?.timeLabel ?? '',
    arrivalLabel: session
      ? buildArrivalLabel(
          getConfirmationContent(sessionType).arrival,
          session.isoDate,
          session.endIso,
          { lastOfDay: session.isLastOfDay }
        )
      : undefined,
    location: session?.location ?? 'Pyre Sauna',
    // manageUrl: `${siteUrl}/account`,
    sessionImageUrl: session?.imageUrl,
    sessionType,
    calendarLinks: session
      ? buildCalendarLinks({
          title: session.title,
          startIso: session.isoDate,
          endIso: session.endIso,
        })
      : undefined,
  };

  // --- Confirmation (always; idempotent per booking) ---
  const confirmationKey = `confirmation:${sessionBookingId}`;
  const sentAlready = await alreadySent(confirmationKey);

  if (sentAlready) {
    log.info(`Confirmation already sent for booking ${sessionBookingId} — skipping`);
  } else {
    await tracer.span(
      'Send confirmation',
      async () => {
        const result = await sendTemplate({ to: member.email, template: 'confirmation', props });
        if (result.status === 'sent') {
          await markSent(confirmationKey);
        }
        return result;
      },
      { to: member.email, sessionType }
    );
  }
}
