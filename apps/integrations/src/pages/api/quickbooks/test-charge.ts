// Step 3c sample call: create a Payments API charge
// (POST /quickbooks/v4/payments/charges). Sandbox-only by design — this route
// exists to prove the payment scope end-to-end with Intuit's documented test
// card, not to move real money.

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireAdmin } from '@/lib/auth/admin';
import { createCharge, toErrorResponse } from '@/lib/quickbooks/client';
import { getEnvironment } from '@/lib/quickbooks/config';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

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
    return new Response(JSON.stringify({ error: 'Test charges are sandbox-only' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  // Callers may POST their own charge body; empty body = documented test card.
  let charge: Record<string, unknown> = SANDBOX_TEST_CHARGE;
  const raw = await request.text();
  if (raw.trim()) {
    try {
      charge = JSON.parse(raw);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }
  }

  try {
    const result = await createCharge(charge);
    return new Response(JSON.stringify(result), { status: 201, headers: JSON_HEADERS });
  } catch (error) {
    return toErrorResponse(error);
  }
};
