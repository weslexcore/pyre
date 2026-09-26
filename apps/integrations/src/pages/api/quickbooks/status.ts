// Connection status (GET) and disconnect (DELETE) for the QuickBooks link.
// Never returns token material — only realm, expiries, and who connected it.

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireAdmin } from '@/lib/auth/admin';
import { json } from '@/lib/http/route';
import { revokeToken } from '@/lib/quickbooks/oauth';
import { deleteConnection, getConnection } from '@/lib/quickbooks/store';

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const connection = await getConnection();
  if (!connection) {
    return json({ connected: false });
  }

  return json({
    connected: true,
    realmId: connection.realmId,
    environment: connection.environment,
    connectedBy: connection.connectedBy,
    accessTokenExpiresAt: new Date(connection.accessTokenExpiresAt).toISOString(),
    refreshTokenExpiresAt: new Date(connection.refreshTokenExpiresAt).toISOString(),
  });
};

export const DELETE: APIRoute = async ({ cookies, request }) => {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const connection = await getConnection();
  if (!connection) {
    return json({ connected: false });
  }

  await revokeToken(connection.refreshToken);
  await deleteConnection(connection.realmId);

  return json({ connected: false, revoked: true });
};
