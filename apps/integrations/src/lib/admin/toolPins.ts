// Read side of admin_tool_pins: the caller's ordered pinned tool hrefs for
// the /admin dashboard and the nav menu. Server-only (imports getDb) — the
// pure list helpers live in ./pinOrder so they can ship to the client.

import { getDb } from '../db';

/**
 * Ordered pinned tool hrefs for `email`; [] when none are pinned or storage
 * is unavailable — pins are cosmetic and must never block a page render.
 * Hrefs come back unfiltered; callers intersect with their already
 * access-filtered tool list, which is what drops pins for revoked tools.
 */
export async function getToolPins(email: string): Promise<string[]> {
  const db = getDb();
  if (!db) return [];

  const { data, error } = await db
    .from('admin_tool_pins')
    .select('tool_href')
    .eq('user_email', email.toLowerCase())
    .order('sort_order', { ascending: true })
    .order('tool_href', { ascending: true });
  if (error) {
    console.error('[toolPins] failed to read pins:', error.message);
    return [];
  }
  return (data ?? []).map((row) => row.tool_href as string);
}
