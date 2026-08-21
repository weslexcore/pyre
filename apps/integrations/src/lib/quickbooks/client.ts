// Authenticated QuickBooks API client. Wraps the stored connection with
// proactive refresh (5-minute buffer) plus one forced-refresh retry on a 401,
// and persists rotated refresh tokens immediately — losing a rotated refresh
// token kills the grant and forces a manual reconnect.

import { getApiBases } from './config';
import { isTokenExpired, refreshTokens } from './oauth';
import { getConnection, type QuickBooksConnection, saveConnection } from './store';

/** Accounting API minor version pinned so response shapes stay stable. */
const MINOR_VERSION = '75';

export class QuickBooksNotConnectedError extends Error {
  constructor() {
    super('QuickBooks is not connected. Visit /api/quickbooks/connect to authorize.');
    this.name = 'QuickBooksNotConnectedError';
  }
}

/** Upstream error carrying Intuit's status + response body for the caller. */
export class QuickBooksApiError extends Error {
  constructor(
    public status: number,
    public body: string
  ) {
    super(`QuickBooks API error ${status}: ${body.substring(0, 200)}`);
    this.name = 'QuickBooksApiError';
  }
}

/** Map client errors onto the JSON error Response shape the routes return. */
export function toErrorResponse(error: unknown): Response {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

  if (error instanceof QuickBooksNotConnectedError) {
    return new Response(JSON.stringify({ error: error.message }), { status: 409, headers });
  }
  if (error instanceof QuickBooksApiError) {
    // Surface Intuit's own status + fault body so failures are debuggable.
    return new Response(JSON.stringify({ error: 'QuickBooks API error', upstream: error.body }), {
      status: error.status,
      headers,
    });
  }
  console.error('[QuickBooks] request failed:', error);
  return new Response(JSON.stringify({ error: 'QuickBooks request failed' }), {
    status: 502,
    headers,
  });
}

async function getFreshConnection(forceRefresh = false): Promise<QuickBooksConnection> {
  const connection = await getConnection();
  if (!connection) throw new QuickBooksNotConnectedError();

  if (!forceRefresh && !isTokenExpired(connection.accessTokenExpiresAt)) {
    return connection;
  }

  if (isTokenExpired(connection.refreshTokenExpiresAt, 0)) {
    // The ~100-day refresh token lapsed; only a human re-consent fixes this.
    throw new QuickBooksNotConnectedError();
  }

  const tokens = await refreshTokens(connection.refreshToken);
  await saveConnection(connection.realmId, tokens);
  return { ...connection, ...tokens };
}

/**
 * Fetch against a QuickBooks API and parse the JSON response. `url` is built
 * by the caller from a base + the live connection (buildUrl receives the
 * realm), because Accounting paths embed the realm id.
 */
async function qboFetch(
  buildUrl: (connection: QuickBooksConnection) => string,
  init: RequestInit = {}
): Promise<unknown> {
  let connection = await getFreshConnection();

  for (let attempt = 0; ; attempt++) {
    const response = await fetch(buildUrl(connection), {
      ...init,
      headers: {
        Authorization: `Bearer ${connection.accessToken}`,
        Accept: 'application/json',
        ...init.headers,
      },
    });

    // A 401 despite our expiry math means the token died early (e.g. the
    // grant was revoked in Intuit's UI) — force one refresh and retry.
    if (response.status === 401 && attempt === 0) {
      connection = await getFreshConnection(true);
      continue;
    }

    const text = await response.text();
    if (!response.ok) throw new QuickBooksApiError(response.status, text);
    return text ? JSON.parse(text) : null;
  }
}

/** Step 3a — CompanyInfo from the Accounting API, scoped to the realm. */
export async function getCompanyInfo(): Promise<unknown> {
  return qboFetch(
    (c) =>
      `${getApiBases().accounting}/v3/company/${c.realmId}/companyinfo/${c.realmId}?minorversion=${MINOR_VERSION}`
  );
}

/** Step 3b — OpenID Connect userinfo for the consenting Intuit account. */
export async function getUserInfo(): Promise<unknown> {
  return qboFetch(() => getApiBases().userinfo);
}

/**
 * Step 3c — create a Payments API charge. `Request-Id` makes the call
 * idempotent on Intuit's side; retrying with the same id can't double-charge.
 */
export async function createCharge(charge: Record<string, unknown>): Promise<unknown> {
  return qboFetch(() => `${getApiBases().payments}/quickbooks/v4/payments/charges`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Request-Id': crypto.randomUUID(),
    },
    body: JSON.stringify(charge),
  });
}
