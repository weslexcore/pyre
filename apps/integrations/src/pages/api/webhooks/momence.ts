import {
  createWebhookLogger,
  setSubscriberTags,
  updateSubscriberAddress,
  upsertSubscriber,
  type WebhookTracer,
} from '@pyre/webhook-core';
import { sendBookingConfirmationEmails } from '@/lib/email/triggers/booking-confirmation';
import { instrumentWebhook, type TracedAPIRoute } from '@/lib/webhooks/instrument';
import {
  fetchMomenceMember,
  type MomenceAddressPayload,
  type MomenceEventType,
  type MomenceMemberPayload,
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

  // Cancellation emails are intentionally out of scope for now.
  if (event !== 'session-booked') return;

  const member = await tracer.span(
    'Fetch Momence member',
    () => fetchMomenceMember(String(payload.targetMemberId)),
    { memberId: payload.targetMemberId }
  );

  await sendBookingConfirmationEmails({
    sessionId: payload.sessionId,
    sessionBookingId: payload.sessionBookingId,
    memberId: payload.targetMemberId,
    member: { email: member.email, firstName: member.firstName },
    tracer,
  });
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
