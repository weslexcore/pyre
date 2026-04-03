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

// --- Host API auth via password grant ---

let cachedToken: { accessToken: string; refreshToken: string; expiresAt: number } | null = null;

async function getHostAccessToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.accessToken;
  }

  // Try refresh first if we have a refresh token
  if (cachedToken?.refreshToken) {
    try {
      const token = await exchangeToken({
        grant_type: 'refresh_token',
        refresh_token: cachedToken.refreshToken,
      });
      return token;
    } catch {
      log.warn('Refresh token failed, falling back to password grant');
      cachedToken = null;
    }
  }

  // Password grant
  const hostEmail = import.meta.env.MOMENCE_HOST_EMAIL;
  const hostPassword = import.meta.env.MOMENCE_HOST_PASSWORD;

  if (!hostEmail || !hostPassword) {
    throw new Error(
      'Missing Momence host credentials (MOMENCE_HOST_EMAIL or MOMENCE_HOST_PASSWORD)'
    );
  }

  return exchangeToken({
    grant_type: 'password',
    username: hostEmail,
    password: hostPassword,
  });
}

async function exchangeToken(params: Record<string, string>): Promise<string> {
  const clientId = import.meta.env.MOMENCE_OAUTH_CLIENT_ID;
  const clientSecret = import.meta.env.MOMENCE_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing Momence OAuth credentials (MOMENCE_OAUTH_CLIENT_ID or MOMENCE_OAUTH_CLIENT_SECRET)'
    );
  }

  log.info(`Token exchange via ${params.grant_type}`);

  const response = await fetch(`${MOMENCE_API_V2}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...params,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    log.error(`Token exchange failed: status=${response.status} body=${body}`);
    throw new Error(`Momence token exchange failed: ${response.status}`);
  }

  const data = await response.json();
  const accessToken = data.access_token || data.accessToken;
  const refreshToken = data.refresh_token || data.refreshToken;
  const expiresIn = data.expires_in || data.expiresIn || 3600;

  cachedToken = {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  log.info('Host access token obtained successfully');
  return accessToken;
}

// --- Member lookup ---

export async function fetchMomenceMember(memberId: string): Promise<{
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  birthday: string;
}> {
  const url = `${MOMENCE_API_V2}/host/members/${memberId}`;

  log.info(`Fetching member ${memberId} from Momence API`, { url });

  const accessToken = await getHostAccessToken();

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  const responseText = await response.text();

  if (!response.ok) {
    log.error(
      `Momence API error for member ${memberId}: status=${response.status} url=${url} body=${responseText}`
    );
    throw new Error(`Momence API returned ${response.status} for member ${memberId}`);
  }

  const data = JSON.parse(responseText);

  log.info(`Member ${memberId} fetched successfully`, {
    email: data.email,
    phoneNumber: data.phoneNumber,
    customerFieldCount: data.customerFields?.length ?? 0,
  });

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
