import { createHmac } from 'node:crypto';

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

/** Fired when an async report run (POST /host/reports) finishes. */
/**
 * `session-created` / `session-updated`. Momence sends the session's shape
 * but not its tags. Nothing acts on these today — the schedule lint reads the
 * feed once a day rather than reacting to each edit.
 */
export interface MomenceSessionPayload {
  sessionId: number;
  type?: string;
  name?: string;
  startsAt?: string;
  endsAt?: string;
}

export interface MomenceReportRunPayload {
  /** The report run id — matches what createReportRun returned. */
  id: number;
  reportUrlWeb: string;
  reportUrlApi: string;
}

/** Fired for every successful charge — a pack, a membership, a product, and
 * the $0 booking a pack pays for. Only the transaction id is included; see
 * fetchPaymentTransaction for the rest. */
export interface MomencePaymentTransactionPayload {
  id: number;
}

export type MomenceEventType =
  | 'member-assigned'
  | 'member-updated'
  | 'member-address-created'
  | 'member-address-updated'
  | 'member-address-deleted'
  | 'session-booked'
  | 'session-booking-cancelled'
  | 'session-created'
  | 'session-updated'
  | 'host-report-run-completed'
  | 'payment-transaction-succeeded';

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
