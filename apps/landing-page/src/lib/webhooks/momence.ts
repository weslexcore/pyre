import { createHmac } from 'node:crypto';
import { createWebhookLogger } from './logger';

const log = createWebhookLogger('Momence');

const MOMENCE_API_V2 = 'https://api.momence.com/api/v2';

// --- Types ---

export interface MomenceMemberPayload {
  memberId: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface MomenceAddressPayload {
  memberAddressId: string;
  memberId: string;
  address: string;
  zipcode: string;
  city: string;
  country: string;
}

export type MomenceEventType =
  | 'member-assigned'
  | 'member-updated'
  | 'member-address-created'
  | 'member-address-updated'
  | 'member-address-deleted';

export interface MomenceWebhookResult<T = unknown> {
  event: string;
  payload: T;
  requestId: string;
  timestamp: string;
}

// --- Verification ---

export class WebhookVerificationError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

export async function verifyMomenceWebhook(request: Request): Promise<MomenceWebhookResult> {
  const secret = request.headers.get('x-webhook-secret');
  const expectedSecret = import.meta.env.MOMENCE_WEBHOOK_SECRET;

  if (!expectedSecret) {
    throw new WebhookVerificationError('MOMENCE_WEBHOOK_SECRET not configured', 500);
  }

  if (secret !== expectedSecret) {
    throw new WebhookVerificationError('Invalid webhook secret', 401);
  }

  const body = await request.json();
  const payloadString: string = body.payload;

  if (!payloadString || typeof payloadString !== 'string') {
    throw new WebhookVerificationError('Missing or invalid payload', 400);
  }

  // Verify HMAC-SHA256 signature
  const signature = request.headers.get('x-webhook-signature');
  const signingSecret = import.meta.env.MOMENCE_WEBHOOK_SIGNING_SECRET;

  if (signingSecret && signature) {
    const expectedSignature = createHmac('sha256', signingSecret)
      .update(payloadString)
      .digest('hex');
    if (signature !== expectedSignature) {
      throw new WebhookVerificationError('Invalid webhook signature', 401);
    }
  }

  const parsed = JSON.parse(payloadString);
  // Note: Momence has a typo in the header name ("reqeuest" instead of "request")
  const requestId = request.headers.get('x-webhook-reqeuest-id') ?? 'unknown';

  return {
    event: parsed.event,
    payload: parsed.payload,
    requestId,
    timestamp: parsed.timestamp,
  };
}

// --- Member lookup ---

function getHostBasicAuth(): string {
  const clientId = import.meta.env.MOMENCE_OAUTH_CLIENT_ID;
  const clientSecret = import.meta.env.MOMENCE_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing Momence OAuth credentials (MOMENCE_OAUTH_CLIENT_ID or MOMENCE_OAUTH_CLIENT_SECRET)'
    );
  }

  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

export async function fetchMomenceMember(memberId: string): Promise<{
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  birthday: string;
}> {
  const url = `${MOMENCE_API_V2}/host/members/${memberId}`;

  log.info(`Fetching member ${memberId} from Momence API`);

  const response = await fetch(url, {
    headers: {
      Authorization: getHostBasicAuth(),
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Momence API returned ${response.status} for member ${memberId}`);
  }

  const data = await response.json();

  // Birthday is stored in customerFields as a "date-of-birth" type field
  const birthdayField = data.customerFields?.find(
    (f: { type: string }) => f.type === 'date-of-birth'
  );

  return {
    email: data.email,
    firstName: data.firstName,
    lastName: data.lastName,
    phone: data.phoneNumber ?? '',
    birthday: birthdayField?.value ?? '',
  };
}
