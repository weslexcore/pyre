import { createWebhookLogger, type WebhookTracer } from '@pyre/webhook-core';
import type { ConfirmationEmailProps } from '@/emails/types';
import { FIRST_TIMER_FAQS } from '@/lib/email/faq-content';
import { resolveSession } from '@/lib/momence-events';
import { isMemberFirstBooking } from '@/lib/webhooks/momence';
import { alreadySent, markSent } from '../idempotency';
import { sendTemplate } from '../send';

const log = createWebhookLogger('BookingEmail');


interface BookingEmailArgs {
  sessionId: number;
  sessionBookingId: number;
  memberId: number;
  member: { email: string; firstName: string };
  tracer: WebhookTracer;
}

/**
 * Orchestrates emails for a `session-booked` event:
 *  1. Always a confirmation (guided / social / general fallback), idempotent.
 *  2. A first-timer welcome on the member's first ever booking (fail-safe).
 *
 * The confirmation send is allowed to throw (Momence then retries). The
 * first-timer step is best-effort and never blocks the confirmation.
 */
export async function sendBookingConfirmationEmails({
  sessionId,
  sessionBookingId,
  memberId,
  member,
  tracer,
}: BookingEmailArgs): Promise<void> {
  const session = await tracer.span('Resolve session', () => resolveSession(sessionId), {
    sessionId,
  });

  const sessionType = session?.sessionType ?? 'unknown';

  const props: ConfirmationEmailProps = {
    firstName: member.firstName || 'there',
    sessionTitle: session?.title ?? 'Your Pyre session',
    dateLabel: session?.dateLabel ?? 'See your account for details',
    timeLabel: session?.timeLabel ?? '',
    location: session?.location ?? 'Pyre Sauna',
    // manageUrl: `${siteUrl}/account`,
    sessionImageUrl: session?.imageUrl,
    sessionType,
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

  // --- First-timer welcome (best-effort, fail-safe) ---
  try {
    const firstTimerKey = `firsttimer:${memberId}`;
    if (await alreadySent(firstTimerKey)) {
      log.info(`First-timer email already sent to member ${memberId} — skipping`);
      return;
    }

    const isFirst = await tracer.span(
      'Check first booking',
      () => isMemberFirstBooking(String(memberId), sessionBookingId),
      { memberId }
    );

    if (isFirst === null) {
      log.info(`First-timer status unknown for member ${memberId} — skipping (fail safe)`);
      return;
    }
    if (!isFirst) return;

    await tracer.span(
      'Send first-timer-welcome',
      async () => {
        const result = await sendTemplate({
          to: member.email,
          template: 'first-timer-welcome',
          props: {
            firstName: member.firstName || 'there',
            faqs: FIRST_TIMER_FAQS,
            // manageUrl: `${siteUrl}/account`,
            directionsUrl: 'https://maps.google.com/?q=Pyre+Sauna',
          },
        });
        if (result.status === 'sent') {
          await markSent(firstTimerKey);
        }
        return result;
      },
      { to: member.email }
    );
  } catch (error) {
    // Never let first-timer failures block the (already-sent) confirmation.
    log.error(`First-timer email failed for member ${memberId}`, error);
  }
}
