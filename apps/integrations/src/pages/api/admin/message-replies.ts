// Replies on an admin message: the thread under each entry of
// /admin/messages, where anyone who can see the message answers and the
// admin answers back. Whoever can see a message that isn't archived may
// reply; editing and deleting a reply is its author or an admin. Author
// identity always comes from the session.
//
// Reads happen on the messages route (GET /api/admin/messages?id= returns
// the thread); this route only mutates.
//
//   POST   { messageId, bodyMd } → { reply, people }
//   PATCH  { id, bodyMd }        → { reply, people }
//   DELETE ?id=<uuid>            → { ok: true }

import type { APIRoute } from 'astro';
import { type AdminGate, assertSameOrigin, requireStaff } from '@/lib/auth/admin';
import { type AdminMessageReplyRow, type AdminMessageRow, getDb } from '@/lib/db';
import { canReplyToMessage, canTouchReply, canViewMessage } from '@/lib/messages/access';
import { normalizeBody, REPLY_MAX } from '@/lib/messages/validate';
import { notifyMessageReply } from '@/lib/notifications/messages';
import { normalizeEmail, type SopViewer } from '@/lib/sops/levels';
import { getPeopleNames } from '@/lib/sops/people';
import { getSopRole } from '@/lib/sops/role';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Db = NonNullable<ReturnType<typeof getDb>>;

async function viewerOf(gate: AdminGate): Promise<SopViewer> {
  return {
    role: await getSopRole(gate.user.email ?? null, gate.access),
    email: normalizeEmail(gate.user.email),
  };
}

function peopleFor(reply: AdminMessageReplyRow) {
  return getPeopleNames([reply.author_email, reply.updated_by ?? '']);
}

/** Parse a JSON body after the shared gate / origin / content-type checks. */
async function gated(
  cookies: Parameters<typeof requireStaff>[0],
  request: Request
): Promise<{ viewer: SopViewer; db: Db; body: Record<string, unknown> } | Response> {
  const gate = await requireStaff(cookies);
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }
  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);
  const viewer = await viewerOf(gate);
  if (!viewer.email) return json({ error: 'Session has no email' }, 400);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  return { viewer, db, body };
}

/** The message a reply hangs off, for a caller who may see it; else 404. */
async function loadVisibleMessage(
  db: Db,
  id: string,
  viewer: SopViewer
): Promise<AdminMessageRow | Response> {
  const { data, error } = await db.from('admin_messages').select('*').eq('id', id).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  const message = (data as AdminMessageRow | null) ?? null;
  if (!message || !canViewMessage(viewer, message))
    return json({ error: 'Message not found' }, 404);
  return message;
}

/** The reply `id` for a caller about to change it: 404 unless visible, 403 unless theirs. */
async function loadOwnReply(
  db: Db,
  id: string,
  viewer: SopViewer
): Promise<AdminMessageReplyRow | Response> {
  const { data, error } = await db
    .from('admin_message_replies')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  const reply = (data as AdminMessageReplyRow | null) ?? null;
  if (!reply) return json({ error: 'Reply not found' }, 404);
  const message = await loadVisibleMessage(db, reply.message_id, viewer);
  if (message instanceof Response) return json({ error: 'Reply not found' }, 404);
  if (!canTouchReply(reply, viewer)) {
    return json({ error: "Only the reply's author or an admin can change it" }, 403);
  }
  return reply;
}

export const POST: APIRoute = async ({ cookies, request }) => {
  const ctx = await gated(cookies, request);
  if (ctx instanceof Response) return ctx;
  const { viewer, db, body } = ctx;

  const messageId = typeof body.messageId === 'string' ? body.messageId : '';
  if (!UUID_RE.test(messageId)) return json({ error: 'messageId must be a UUID' }, 400);
  const bodyMd = normalizeBody(body.bodyMd, REPLY_MAX);
  if (!bodyMd)
    return json({ error: `bodyMd must be non-empty text (max ${REPLY_MAX} chars)` }, 400);

  const message = await loadVisibleMessage(db, messageId, viewer);
  if (message instanceof Response) return message;
  if (!canReplyToMessage(viewer, message)) return json({ error: 'This message is archived' }, 409);

  // Who was already in the conversation, before this reply joins it.
  const { data: earlier } = await db
    .from('admin_message_replies')
    .select('author_email')
    .eq('message_id', messageId);

  const { data, error } = await db
    .from('admin_message_replies')
    .insert({ message_id: messageId, body_md: bodyMd, author_email: viewer.email })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);
  const reply = data as AdminMessageReplyRow;

  await notifyMessageReply(
    db,
    message,
    reply,
    (earlier ?? []) as Pick<AdminMessageReplyRow, 'author_email'>[]
  );
  return json({ reply, people: await peopleFor(reply) }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const ctx = await gated(cookies, request);
  if (ctx instanceof Response) return ctx;
  const { viewer, db, body } = ctx;

  const id = typeof body.id === 'string' ? body.id : '';
  if (!UUID_RE.test(id)) return json({ error: 'id must be a UUID' }, 400);
  const bodyMd = normalizeBody(body.bodyMd, REPLY_MAX);
  if (!bodyMd)
    return json({ error: `bodyMd must be non-empty text (max ${REPLY_MAX} chars)` }, 400);

  const existing = await loadOwnReply(db, id, viewer);
  if (existing instanceof Response) return existing;

  const { data, error } = await db
    .from('admin_message_replies')
    .update({ body_md: bodyMd, updated_by: viewer.email })
    .eq('id', id)
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);
  const reply = data as AdminMessageReplyRow;
  return json({ reply, people: await peopleFor(reply) });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const gate = await requireStaff(cookies);
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);
  const viewer = await viewerOf(gate);

  const id = url.searchParams.get('id') ?? '';
  if (!UUID_RE.test(id)) return json({ error: 'id must be a UUID' }, 400);

  const existing = await loadOwnReply(db, id, viewer);
  if (existing instanceof Response) return existing;

  const { error } = await db.from('admin_message_replies').delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
};
