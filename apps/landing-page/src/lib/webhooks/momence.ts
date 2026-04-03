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

export async function getHostAccessToken(): Promise<string> {
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

// --- Member data ---

export interface MomenceMemberData {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  birthday: string;
}

function mapMemberData(data: Record<string, unknown>): MomenceMemberData {
  const customerFields = data.customerFields as { type: string; value: string }[] | undefined;
  const birthdayField = customerFields?.find((f) => f.type === 'date-of-birth');

  return {
    email: data.email as string,
    firstName: data.firstName as string,
    lastName: data.lastName as string,
    phone: (data.phoneNumber as string) ?? '',
    birthday: birthdayField?.value ?? '',
  };
}

// --- Member lookup ---

export async function fetchMomenceMember(memberId: string): Promise<MomenceMemberData> {
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

  return mapMemberData(data);
}

// --- Member list (for backfill) ---

export interface FetchMomenceMembersResult {
  members: MomenceMemberData[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export async function fetchMomenceMembers(
  page: number,
  pageSize: number
): Promise<FetchMomenceMembersResult> {
  const accessToken = await getHostAccessToken();

  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    sortBy: 'lastSeenAt',
    sortOrder: 'DESC',
  });

  const url = `${MOMENCE_API_V2}/host/members?${params}`;
  log.info(`Fetching members page ${page} (pageSize=${pageSize})`, { url });

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  const responseText = await response.text();

  if (!response.ok) {
    log.error(`Momence members list error: status=${response.status} body=${responseText}`);
    throw new Error(`Momence API returned ${response.status} for members list`);
  }

  const data = JSON.parse(responseText);

  // Log raw response keys to identify the correct field names
  log.info('Momence members list response keys', {
    keys: Object.keys(data),
    totalCount: data.totalCount,
    total: data.total,
    count: data.count,
    page: data.page,
    pageSize: data.pageSize,
    payloadLength: Array.isArray(data.payload) ? data.payload.length : 'not an array',
  });

  const members = (data.payload as Record<string, unknown>[]).map(mapMemberData);

  log.info(`Fetched ${members.length} members (total: ${data.totalCount ?? data.total ?? 'unknown'})`);

  return {
    members,
    totalCount: data.totalCount,
    page: data.page,
    pageSize: data.pageSize,
  };
}
