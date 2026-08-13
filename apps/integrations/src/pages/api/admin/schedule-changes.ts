// Read endpoint for the schedule change log (/admin/schedule/changes).
// Admin-only — the log names who did what (including staff members' own
// time-off edits), so it is not part of the schedule page grant. Newest
// first, keyset-paginated on created_at via `before`.

import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import type { ChangeEntityType, ScheduleChangeRow } from '@/lib/schedule/change-log';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const ENTITY_TYPES: ChangeEntityType[] = [
  'shift',
  'assignment',
  'time_off',
  'proposal',
  'sync',
  'request',
  'sub_request',
];

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const rawLimit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  let query = db
    .from('schedule_changes')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  const entityType = url.searchParams.get('entityType');
  if (entityType) {
    if (!ENTITY_TYPES.includes(entityType as ChangeEntityType)) {
      return json({ error: `entityType must be one of ${ENTITY_TYPES.join(', ')}` }, 400);
    }
    query = query.eq('entity_type', entityType);
  }

  // Cursor for "load more": the created_at of the oldest row already shown.
  const before = url.searchParams.get('before');
  if (before) {
    if (Number.isNaN(Date.parse(before))) {
      return json({ error: 'before must be an ISO timestamp' }, 400);
    }
    query = query.lt('created_at', before);
  }

  const { data, error } = await query;
  if (error) return json({ error: error.message }, 500);

  const entries = (data ?? []) as ScheduleChangeRow[];
  return json({ entries, hasMore: entries.length === limit });
};
