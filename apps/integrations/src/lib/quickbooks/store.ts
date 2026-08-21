// Durable token storage for the QuickBooks connection, backed by the
// quickbooks_tokens table (service-role via getDb()). One row per connected
// realm; in practice Pyre connects a single company, so reads take the most
// recently updated row.

import { getDb, type QuickBooksTokenRow } from '@/lib/db';
import { getEnvironment } from './config';
import type { QuickBooksTokenData } from './oauth';

export interface QuickBooksConnection extends QuickBooksTokenData {
  realmId: string;
  environment: 'sandbox' | 'production';
  connectedBy: string | null;
}

function toConnection(row: QuickBooksTokenRow): QuickBooksConnection {
  return {
    realmId: row.realm_id,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    accessTokenExpiresAt: new Date(row.access_token_expires_at).getTime(),
    refreshTokenExpiresAt: new Date(row.refresh_token_expires_at).getTime(),
    environment: row.environment,
    connectedBy: row.connected_by,
  };
}

/** The stored connection for the active environment, or null if not connected. */
export async function getConnection(): Promise<QuickBooksConnection | null> {
  const db = getDb();
  if (!db) return null;

  const { data, error } = await db
    .from('quickbooks_tokens')
    .select('*')
    .eq('environment', getEnvironment())
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[QuickBooks] token read failed:', error.message);
    return null;
  }

  return data ? toConnection(data as QuickBooksTokenRow) : null;
}

/**
 * Upsert the tokens for a realm. Called from the OAuth callback (with
 * connectedBy) and after every refresh (tokens rotate, so persisting
 * immediately is what keeps the grant alive).
 */
export async function saveConnection(
  realmId: string,
  tokens: QuickBooksTokenData,
  connectedBy?: string
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Supabase not configured; cannot store QuickBooks tokens');

  const row: Partial<QuickBooksTokenRow> = {
    realm_id: realmId,
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    access_token_expires_at: new Date(tokens.accessTokenExpiresAt).toISOString(),
    refresh_token_expires_at: new Date(tokens.refreshTokenExpiresAt).toISOString(),
    environment: getEnvironment(),
  };
  if (connectedBy !== undefined) row.connected_by = connectedBy;

  const { error } = await db.from('quickbooks_tokens').upsert(row, { onConflict: 'realm_id' });
  if (error) throw new Error(`QuickBooks token save failed: ${error.message}`);
}

export async function deleteConnection(realmId: string): Promise<void> {
  const db = getDb();
  if (!db) return;

  const { error } = await db.from('quickbooks_tokens').delete().eq('realm_id', realmId);
  if (error) console.error('[QuickBooks] token delete failed:', error.message);
}
