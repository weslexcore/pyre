import { createWebhookLogger, type WebhookTracer } from '@pyre/webhook-core';
import type { EmailTemplateKey } from '@/emails/registry';
import type { ConfirmationEmailProps, FaqItem } from '@/emails/types';
import { resolveSession } from '@/lib/momence-events';
import { isMemberFirstBooking } from '@/lib/webhooks/momence';
import { alreadySent, markSent } from '../idempotency';
import { sendTemplate } from '../send';

const log = createWebhookLogger('BookingEmail');

// Session type -> confirmation template. Anything not listed falls back to the
// general confirmation, so EVERY booking always receives a confirmation.
const CONFIRMATION_BY_TYPE: Record<string, EmailTemplateKey> = {
  guided: 'guided-confirmation',
  social: 'social-confirmation',
  'special event': 'special-event-confirmation',
};
const DEFAULT_CONFIRMATION: EmailTemplateKey = 'general-confirmation';

// A short curated subset for first-timers (kept here rather than imported from
// landing-page, which is a separate workspace).
const FIRST_TIMER_FAQS: FaqItem[] = [
  {
    question: 'What should I bring to my session?',
    answer:
      'Bring a swimsuit, a water bottle and an optional robe / sandals. We provide towels and all the amenities you need for your session.',
  },
  {
    question: 'How hot does the sauna get?',
    answer: 'Our traditional Finnish saunas reach temperatures between 170-195°F.',
  },
  {
    question: 'How long should I stay in the sauna and cold plunge?',
    answer:
      'We recommend 10-20 minute sauna sessions followed by 1-3 minute cold plunge immersions. Repeat 2-4 rounds for optimal benefits.',
  },
];

function getSiteUrl(): string {
  return import.meta.env.PUBLIC_SITE_URL ?? 'https://pyresauna.com';
}

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
  const template = CONFIRMATION_BY_TYPE[sessionType] ?? DEFAULT_CONFIRMATION;

  const siteUrl = getSiteUrl();
  const props: ConfirmationEmailProps = {
    firstName: member.firstName || 'there',
    sessionTitle: session?.title ?? 'Your Pyre session',
    dateLabel: session?.dateLabel ?? 'See your account for details',
    timeLabel: session?.timeLabel ?? '',
    location: session?.location ?? 'Pyre Sauna',
    manageUrl: `${siteUrl}/account`,
    sessionImageUrl: session?.imageUrl,
  };

  // --- Confirmation (always; idempotent per booking) ---
  const confirmationKey = `confirmation:${sessionBookingId}`;
  const sentAlready = await alreadySent(confirmationKey);

  if (sentAlready) {
    log.info(`Confirmation already sent for booking ${sessionBookingId} — skipping`);
  } else {
    await tracer.span(
      `Send ${template}`,
      async () => {
        const result = await sendTemplate({ to: member.email, template, props });
        if (result.status === 'sent') {
          await markSent(confirmationKey);
        }
        return result;
      },
      { to: member.email, template, sessionType }
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
            manageUrl: `${siteUrl}/account`,
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
