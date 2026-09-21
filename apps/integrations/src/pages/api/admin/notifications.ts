// One person's inbox: the bell in the header and /admin/notifications both
// read from here, and both mark rows read or clear them through it. Every
// query is scoped to the session's own email — there is no way to read or
// touch anyone else's rows, and no admin override, since an inbox is
// personal. Any dashboard user has one.
//
//   GET   ?limit=<n>[&sweep=1]                        → { notifications, unreadCount, viewer }
//   PATCH { ids?: uuid[], all?: true, read?: boolean, dismissed?: true }
//                                                     → { ok, unreadCount }
//
// `all` marks every live row read (only with read: true). Dismissing a row
// also reads it. The list is live rows only (not dismissed, not expired),
// newest first; the island puts unread rows first. `sweep=1` (the inbox
// page, not the bell's poll) also clears the caller's long-dead rows.

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireStaff } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import { countUnread, dismiss, listInbox, markRead, sweepInbox } from '@/lib/notifications/notify';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_IDS = 200;

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requireStaff(cookies);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const email = (gate.user.email ?? '').trim().toLowerCase();
  if (!email) return json({ error: 'Session has no email' }, 400);

  const rawLimit = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT;

  if (url.searchParams.get('sweep') === '1') await sweepInbox(db, email);
  const { rows, error } = await listInbox(db, email, limit);
  if (error) return json({ error }, 500);

  return json({
    notifications: rows,
    unreadCount: await countUnread(db, email),
    viewer: { email },
  });
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const gate = await requireStaff(cookies);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const email = (gate.user.email ?? '').trim().toLowerCase();
  if (!email) return json({ error: 'Session has no email' }, 400);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const all = body.all === true;
  const ids = body.ids;
  if (!all) {
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.length > MAX_IDS ||
      !ids.every((id): id is string => typeof id === 'string' && UUID_RE.test(id))
    ) {
      return json({ error: 'ids must be a non-empty list of UUIDs (or all: true)' }, 400);
    }
  }

  if (body.dismissed === true) {
    if (all) return json({ error: 'dismiss needs explicit ids' }, 400);
    const error = await dismiss(db, email, ids as string[]);
    if (error) return json({ error }, 500);
  } else if (body.read === true) {
    const error = await markRead(db, email, all ? 'all' : (ids as string[]));
    if (error) return json({ error }, 500);
  } else {
    return json({ error: 'Nothing to update: pass read: true or dismissed: true' }, 400);
  }

  return json({ ok: true, unreadCount: await countUnread(db, email) });
};
