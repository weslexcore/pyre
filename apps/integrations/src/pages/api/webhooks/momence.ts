import {
  createWebhookLogger,
  setSubscriberTags,
  updateSubscriberAddress,
  upsertSubscriber,
  type WebhookTracer,
} from '@pyre/webhook-core';
import { inferBookingAttribution } from '@/lib/analytics/booking-attribution';
import { trackBookingEvent } from '@/lib/analytics/track-booking';
import { upsertResendContact } from '@/lib/email/audience';
import { sendBookingConfirmationEmails } from '@/lib/email/triggers/booking-confirmation';
import { resolveSession } from '@/lib/momence-events';
import { handleReferralBooking, handleReferralCancellation } from '@/lib/referral/conversion';
import { dispatchTrigger } from '@/lib/triggers/dispatch';
import { instrumentWebhook, type TracedAPIRoute } from '@/lib/webhooks/instrument';
import {
  fetchMomenceMember,
  type MomenceAddressPayload,
  type MomenceEventType,
  type MomenceMemberPayload,
  type MomenceReportRunPayload,
  verifyMomenceWebhook,
  WebhookVerificationError,
} from '@/lib/webhooks/momence';

export const prerender = false;

const log = createWebhookLogger('Momence');

const MEMBER_EVENTS: MomenceEventType[] = ['member-assigned', 'member-updated'];
const ADDRESS_EVENTS: MomenceEventType[] = [
  'member-address-created',
  'member-address-updated',
  'member-address-deleted',
];
const BOOKING_EVENTS: MomenceEventType[] = ['session-booked', 'session-booking-cancelled'];

interface MomenceBookingPayload {
  sessionId: number;
  sessionBookingId: number;
  payingMemberId: number;
  targetMemberId: number;
  isLateCancellation?: boolean;
  cancelledAt?: string;
}

async function handleBookingEvent(
  event: MomenceEventType,
  payload: MomenceBookingPayload,
  tracer: WebhookTracer
): Promise<void> {
  await tracer.span(
    'Log booking event',
    async () => {
      log.info(`${event}`, { payload });
    },
    {
      sessionId: payload.sessionId,
      sessionBookingId: payload.sessionBookingId,
      targetMemberId: payload.targetMemberId,
      ...(payload.isLateCancellation != null && { isLateCancellation: payload.isLateCancellation }),
      ...(payload.cancelledAt && { cancelledAt: payload.cancelledAt }),
    }
  );

  if (event === 'session-booked') {
    const member = await tracer.span(
      'Fetch Momence member',
      () => fetchMomenceMember(String(payload.targetMemberId)),
      { memberId: payload.targetMemberId }
    );

    const session = await tracer.span('Resolve session', () => resolveSession(payload.sessionId), {
      sessionId: payload.sessionId,
    });

    // Click→booking inference is best-effort by contract: inferBookingAttribution
    // never throws and self-limits its latency, so it cannot 500 the webhook or
    // trigger Momence retries.
    const attribution = await tracer.span(
      'Infer booking attribution',
      () => inferBookingAttribution(payload.sessionId),
      { sessionId: payload.sessionId }
    );

    await trackBookingEvent(tracer, 'booking_completed', member, session, payload, attribution);

    await sendBookingConfirmationEmails({
      sessionId: payload.sessionId,
      sessionBookingId: payload.sessionBookingId,
      memberId: payload.targetMemberId,
      member: { email: member.email, firstName: member.firstName },
      session,
      tracer,
    });

    // Journey triggers (best-effort by contract — dispatchTrigger never throws).
    await dispatchTrigger({
      type: 'session-booked',
      memberId: payload.targetMemberId,
      email: member.email,
      firstName: member.firstName,
      lastName: member.lastName,
      sessionId: payload.sessionId,
      sessionBookingId: payload.sessionBookingId,
    });

    // Referral conversion + reward consumption (best-effort by contract —
    // handleReferralBooking catches its own errors).
    await tracer.span(
      'Handle referral booking',
      () =>
        handleReferralBooking({
          sessionId: payload.sessionId,
          sessionBookingId: payload.sessionBookingId,
          targetMemberId: payload.targetMemberId,
          memberEmail: member.email,
        }),
      { targetMemberId: payload.targetMemberId }
    );
    return;
  }

  // Cancellation: confirmation emails are intentionally out of scope, but we still
  // track the event for funnel/churn analysis. Best-effort so it can never 500 the
  // webhook (which would trigger Momence retries).
  try {
    const member = await fetchMomenceMember(String(payload.targetMemberId));
    const session = await resolveSession(payload.sessionId);
    await trackBookingEvent(tracer, 'booking_cancelled', member, session, payload);
  } catch (error) {
    log.warn(`Failed to track booking_cancelled for booking ${payload.sessionBookingId}`, error);
  }

  // Flag a converted referral whose converting booking was cancelled (admin
  // decides on clawback). Catches its own errors.
  await handleReferralCancellation(payload.sessionBookingId);
}

async function handleMemberEvent(
  event: MomenceEventType,
  payload: MomenceMemberPayload,
  tracer: WebhookTracer
): Promise<void> {
  const { email, firstName, lastName, memberId } = payload;

  const member = await tracer.span('Fetch Momence member', () => fetchMomenceMember(memberId), {
    memberId,
  });

  await tracer.span(
    'Upsert Mailchimp subscriber',
    () =>
      upsertSubscriber({
        email,
        firstName,
        lastName,
        phone: member.phone,
        birthday: member.birthday,
      }),
    { email }
  );

  const tags = member.tags.map((name) => ({ name, status: 'active' as const }));
  if (event === 'member-assigned') {
    tags.push({ name: 'Active Guest', status: 'active' });
  }
  if (tags.length > 0) {
    await tracer.span('Set Mailchimp tags', () => setSubscriberTags(email, tags), {
      email,
      tags: tags.map((t) => t.name),
    });
  }

  // Best-effort so a Resend outage never 500s the webhook (Mailchimp already synced).
  try {
    await tracer.span(
      'Upsert Resend contact',
      () => upsertResendContact({ email, firstName, lastName }),
      { email }
    );
  } catch (error) {
    log.warn(`Resend contact upsert failed for ${email}`, error);
  }
}

async function handleAddressEvent(
  event: MomenceEventType,
  payload: MomenceAddressPayload,
  tracer: WebhookTracer
): Promise<void> {
  const member = await tracer.span(
    'Fetch Momence member',
    () => fetchMomenceMember(payload.memberId),
    { memberId: payload.memberId }
  );

  if (event === 'member-address-deleted') {
    await tracer.span(
      'Clear Mailchimp address',
      () => updateSubscriberAddress(member.email, null),
      {
        email: member.email,
      }
    );
  } else {
    await tracer.span(
      'Update Mailchimp address',
      () =>
        updateSubscriberAddress(member.email, {
          addr1: payload.address,
          city: payload.city,
          zip: payload.zipcode,
          country: payload.country,
        }),
      { email: member.email, address: payload.address }
    );
  }
}

/**
 * A report run finished — if it's one the business-report sync is waiting on,
 * persist it right now instead of leaving it parked until a later tick polls.
 * A failure here throws, the route 500s, and Momence's retry gives the
 * (idempotent) persist another chance.
 */
async function handleReportRunCompleted(
  payload: MomenceReportRunPayload,
  tracer: WebhookTracer
): Promise<void> {
  const { processCompletedReportRun } = await import('@/lib/reports/sync');
  const result = await tracer.span(
    'Persist completed report run',
    () => processCompletedReportRun(payload.id),
    { runId: payload.id }
  );

  if (!result.matched) {
    // Runs also get created by hand in the Momence dashboard; nothing to do.
    log.info(`Report run ${payload.id} is not one we're waiting on — ignoring`);
    return;
  }
  log.info(`Report run ${payload.id} processed`, { ...result });
}

const handler: TracedAPIRoute = async ({ request }, tracer) => {
  try {
    const { event, payload, requestId, timestamp } = await tracer.span(
      'Verify webhook',
      () => verifyMomenceWebhook(request),
      {}
    );

    log.info(`Received event: ${event}`, { requestId, timestamp, payload });

    if (MEMBER_EVENTS.includes(event as MomenceEventType)) {
      await handleMemberEvent(event as MomenceEventType, payload as MomenceMemberPayload, tracer);
    } else if (ADDRESS_EVENTS.includes(event as MomenceEventType)) {
      await handleAddressEvent(event as MomenceEventType, payload as MomenceAddressPayload, tracer);
    } else if (BOOKING_EVENTS.includes(event as MomenceEventType)) {
      await handleBookingEvent(event as MomenceEventType, payload as MomenceBookingPayload, tracer);
    } else if (event === 'host-report-run-completed') {
      await handleReportRunCompleted(payload as MomenceReportRunPayload, tracer);
    } else {
      log.info(`Ignoring unhandled event: ${event}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      log.error(`Verification failed: ${error.message}`);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: error.statusCode,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    log.error('Webhook processing failed', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST = instrumentWebhook('momence', handler);
