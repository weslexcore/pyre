// Admin messages: what an admin writes to the team and the threads that
// grow under them (/admin/messages). Reading is open to any dashboard user
// and filtered by the message's audience (lib/messages/access); writing,
// editing, pinning, archiving, and deleting a message is admin-only. Author
// identity always comes from the session. Replies have their own route
// (message-replies.ts).
//
//   GET  [?archived=1]         → { messages, people, viewer, staff? }
//   GET  ?id=<uuid>            → { message, replies, people, viewer }
//   POST { title, bodyMd, audienceRoles, audienceEmails, pinned? }
//                              → { message, people, notified }
//   PATCH { id, title?, bodyMd?, audienceRoles?, audienceEmails?, pinned?, archived? }
//                              → { message, people }
//   DELETE ?id=<uuid>          → { ok: true }
//
// Opening one message marks the viewer's notifications about it read.
// `staff` (the roster the audience picker offers) rides only on the admin
// list response — it is the address book, never handed to non-admins. A
// message the caller can't see reads as missing, never as forbidden.

import type { APIRoute } from 'astro';
import { type AdminGate, assertSameOrigin, requireAdmin, requireStaff } from '@/lib/auth/admin';
import { type AdminMessageRow, getDb } from '@/lib/db';
import { listMessagesForViewer, loadMessageForViewer } from '@/lib/messages/store';
import { BODY_MAX, normalizeBody, normalizeTitle, parseAudience } from '@/lib/messages/validate';
import { notifyMessagePosted } from '@/lib/notifications/messages';
import { deleteBySource, markSourceRead } from '@/lib/notifications/notify';
import { normalizeEmail, type SopViewer } from '@/lib/sops/levels';
import { getPeopleNames, listGrantablePeople } from '@/lib/sops/people';
import { getSopRole } from '@/lib/sops/role';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function viewerOf(gate: AdminGate): Promise<SopViewer> {
  return {
    role: await getSopRole(gate.user.email ?? null, gate.access),
    email: normalizeEmail(gate.user.email),
  };
}

/** The audience emails a request names, checked against the roster. */
async function checkedAudience(
  roles: unknown,
  emails: unknown
): Promise<{ roles: AdminMessageRow['audience_roles']; emails: string[] } | { error: string }> {
  const parsed = parseAudience(roles, emails);
  if (!parsed.ok) return { error: parsed.error };
  const roster = new Set((await listGrantablePeople()).map((person) => person.email));
  const unknown = parsed.audience.emails.filter((email) => !roster.has(email));
  if (unknown.length > 0) {
    return { error: `audienceEmails names people not on the roster: ${unknown.join(', ')}` };
  }
  return parsed.audience;
}

async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requireStaff(cookies);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const viewer = await viewerOf(gate);
  const id = url.searchParams.get('id');
  if (id) {
    if (!UUID_RE.test(id)) return json({ error: 'id must be a UUID' }, 400);
    const result = await loadMessageForViewer(db, viewer, id);
    if (!result.ok) return json({ error: result.error }, result.status);
    if (viewer.email) await markSourceRead(db, viewer.email, 'admin_message', id);
    return json({ ...result.thread, viewer });
  }

  const isAdmin = viewer.role === 'admin';
  const includeArchived = isAdmin && url.searchParams.get('archived') === '1';
  const { messages, people, error } = await listMessagesForViewer(db, viewer, { includeArchived });
  if (error) return json({ error }, 500);
  return json({
    messages,
    people,
    viewer,
    staff: isAdmin ? await listGrantablePeople() : undefined,
  });
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;
  const body = await readJson(request);
  if (body instanceof Response) return body;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const email = normalizeEmail(gate.user.email);
  if (!email) return json({ error: 'Session has no email' }, 400);

  const title = normalizeTitle(body.title);
  if (!title) return json({ error: 'title is required (max 200 chars)' }, 400);
  const bodyMd = normalizeBody(body.bodyMd, BODY_MAX);
  if (!bodyMd) return json({ error: `bodyMd is required (max ${BODY_MAX} chars)` }, 400);
  const audience = await checkedAudience(
    body.audienceRoles ?? ['staff', 'shift_lead', 'admin'],
    body.audienceEmails ?? []
  );
  if ('error' in audience) return json({ error: audience.error }, 400);
  if (body.pinned !== undefined && typeof body.pinned !== 'boolean') {
    return json({ error: 'pinned must be a boolean' }, 400);
  }

  const { data, error } = await db
    .from('admin_messages')
    .insert({
      title,
      body_md: bodyMd,
      author_email: email,
      audience_roles: audience.roles,
      audience_emails: audience.emails,
      pinned: body.pinned === true,
    })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);
  const message = data as AdminMessageRow;

  const notified = await notifyMessagePosted(db, message);
  return json({ message, people: await getPeopleNames([email]), notified }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;
  const body = await readJson(request);
  if (body instanceof Response) return body;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const email = normalizeEmail(gate.user.email);
  if (!email) return json({ error: 'Session has no email' }, 400);

  const id = typeof body.id === 'string' ? body.id : '';
  if (!UUID_RE.test(id)) return json({ error: 'id must be a UUID' }, 400);

  const patch: Partial<AdminMessageRow> = {};
  if (body.title !== undefined) {
    const title = normalizeTitle(body.title);
    if (!title) return json({ error: 'title must be non-empty (max 200 chars)' }, 400);
    patch.title = title;
  }
  if (body.bodyMd !== undefined) {
    const bodyMd = normalizeBody(body.bodyMd, BODY_MAX);
    if (!bodyMd) return json({ error: `bodyMd must be non-empty (max ${BODY_MAX} chars)` }, 400);
    patch.body_md = bodyMd;
  }
  if (body.audienceRoles !== undefined || body.audienceEmails !== undefined) {
    const { data: existing } = await db
      .from('admin_messages')
      .select('audience_roles, audience_emails')
      .eq('id', id)
      .maybeSingle();
    if (!existing) return json({ error: 'Message not found' }, 404);
    const audience = await checkedAudience(
      body.audienceRoles ?? existing.audience_roles,
      body.audienceEmails ?? existing.audience_emails
    );
    if ('error' in audience) return json({ error: audience.error }, 400);
    patch.audience_roles = audience.roles;
    patch.audience_emails = audience.emails;
  }
  if (body.pinned !== undefined) {
    if (typeof body.pinned !== 'boolean') return json({ error: 'pinned must be a boolean' }, 400);
    patch.pinned = body.pinned;
  }
  if (body.archived !== undefined) {
    if (typeof body.archived !== 'boolean')
      return json({ error: 'archived must be a boolean' }, 400);
    patch.archived_at = body.archived ? new Date().toISOString() : null;
  }
  if (Object.keys(patch).length === 0) return json({ error: 'Nothing to update' }, 400);
  patch.updated_by = email;

  const { data, error } = await db
    .from('admin_messages')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: 'Message not found' }, 404);
  const message = data as AdminMessageRow;
  return json({ message, people: await getPeopleNames([message.author_email, email]) });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id') ?? '';
  if (!UUID_RE.test(id)) return json({ error: 'id must be a UUID' }, 400);

  const { error, count } = await db.from('admin_messages').delete({ count: 'exact' }).eq('id', id);
  if (error) return json({ error: error.message }, 500);
  if (!count) return json({ error: 'Message not found' }, 404);
  await deleteBySource(db, 'admin_message', id);

  return json({ ok: true });
};
