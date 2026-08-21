// Connection status (GET) and disconnect (DELETE) for the QuickBooks link.
// Never returns token material — only realm, expiries, and who connected it.

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireAdmin } from '@/lib/auth/admin';
import { revokeToken } from '@/lib/quickbooks/oauth';
import { deleteConnection, getConnection } from '@/lib/quickbooks/store';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const connection = await getConnection();
  if (!connection) {
    return new Response(JSON.stringify({ connected: false }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  }

  return new Response(
    JSON.stringify({
      connected: true,
      realmId: connection.realmId,
      environment: connection.environment,
      connectedBy: connection.connectedBy,
      accessTokenExpiresAt: new Date(connection.accessTokenExpiresAt).toISOString(),
      refreshTokenExpiresAt: new Date(connection.refreshTokenExpiresAt).toISOString(),
    }),
    { status: 200, headers: JSON_HEADERS }
  );
};

export const DELETE: APIRoute = async ({ cookies, request }) => {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const connection = await getConnection();
  if (!connection) {
    return new Response(JSON.stringify({ connected: false }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  }

  await revokeToken(connection.refreshToken);
  await deleteConnection(connection.realmId);

  return new Response(JSON.stringify({ connected: false, revoked: true }), {
    status: 200,
    headers: JSON_HEADERS,
  });
};
