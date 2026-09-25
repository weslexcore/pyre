// Step 3c sample call: create a Payments API charge
// (POST /quickbooks/v4/payments/charges). Sandbox-only by design — this route
// exists to prove the payment scope end-to-end with Intuit's documented test
// card, not to move real money.

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireAdmin } from '@/lib/auth/admin';
import { json } from '@/lib/http/route';
import { createCharge, toErrorResponse } from '@/lib/quickbooks/client';
import { getEnvironment } from '@/lib/quickbooks/config';

// Intuit's sandbox test Visa (developer.intuit.com Payments docs).
const SANDBOX_TEST_CHARGE = {
  amount: '10.55',
  currency: 'USD',
  card: {
    number: '4111111111111111',
    expMonth: '02',
    expYear: '2028',
    cvc: '123',
  },
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  if (getEnvironment() !== 'sandbox') {
    return json({ error: 'Test charges are sandbox-only' }, 400);
  }

  // Callers may POST their own charge body; empty body = documented test card.
  let charge: Record<string, unknown> = SANDBOX_TEST_CHARGE;
  const raw = await request.text();
  if (raw.trim()) {
    try {
      charge = JSON.parse(raw);
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }
  }

  try {
    const result = await createCharge(charge);
    return json(result, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
};
