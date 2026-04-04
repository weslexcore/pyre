import type { APIRoute } from 'astro';
import { instrumentWebhook } from '@/lib/webhooks/instrument';
import { createWebhookLogger } from '@/lib/webhooks/logger';
import {
  setSubscriberTags,
  updateSubscriberAddress,
  upsertSubscriber,
} from '@/lib/webhooks/mailchimp';
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

async function handleMemberEvent(
  event: MomenceEventType,
  payload: MomenceMemberPayload
): Promise<void> {
  const { email, firstName, lastName, memberId } = payload;

  // Fetch full member profile from Momence API to get phone number
  const member = await fetchMomenceMember(memberId);

  await upsertSubscriber({
    email,
    firstName,
    lastName,
    phone: member.phone,
    birthday: member.birthday,
  });

  const tags = member.tags.map((name) => ({ name, status: 'active' as const }));
  if (event === 'member-assigned') {
    tags.push({ name: 'Active Guest', status: 'active' });
  }
  if (tags.length > 0) {
    await setSubscriberTags(email, tags);
  }
}

async function handleAddressEvent(
  event: MomenceEventType,
  payload: MomenceAddressPayload
): Promise<void> {
  const member = await fetchMomenceMember(payload.memberId);

  if (event === 'member-address-deleted') {
    await updateSubscriberAddress(member.email, null);
  } else {
    await updateSubscriberAddress(member.email, {
      addr1: payload.address,
      city: payload.city,
      zip: payload.zipcode,
      country: payload.country,
    });
  }
}

const handler: APIRoute = async ({ request }) => {
  try {
    const { event, payload, requestId, timestamp } = await verifyMomenceWebhook(request);

    log.info(`Received event: ${event}`, { requestId, timestamp, payload });

    if (MEMBER_EVENTS.includes(event as MomenceEventType)) {
      await handleMemberEvent(event as MomenceEventType, payload as MomenceMemberPayload);
    } else if (ADDRESS_EVENTS.includes(event as MomenceEventType)) {
      await handleAddressEvent(event as MomenceEventType, payload as MomenceAddressPayload);
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
