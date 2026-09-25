// Replies on a shift note: the thread under each entry of /admin/shift-notes
// where an admin responds — "ordered the part", "good call, thanks" — and the
// author replies back, so the conversation stays on the note it is about.
// Whoever can see a note may reply to it (admins, and the author on their
// own note); a reply is visible to the same people, unless an admin marked it
// private, which keeps it among the admins. Editing and deleting a reply is
// its author or an admin. Author identity always comes from the session.
//
// The thread is the note's whole activity: these comments, plus the events
// the app records for status changes, edits, and Jev's answers (see
// lib/shift-notes/activity). Events are history — they come back in reads
// but can't be edited or deleted here. The page reads every thread on the
// notes route (GET /api/admin/shift-notes); GET here refreshes one note's,
// e.g. once Jev's answer has landed in it.
//
//   GET    ?noteId=<uuid>               → { replies, people }
//   POST   { noteId, body, isPrivate? } → { reply, people }
//   PATCH  { id, body?, isPrivate? }    → { reply, people }
//   DELETE ?id=<uuid>                   → { ok: true }

import type { APIRoute } from 'astro';
import { SHIFT_NOTES_HREF } from '@/components/admin/adminTools';
import { type AdminGate, assertSameOrigin, requirePage } from '@/lib/auth/admin';
import { getDb, type ShiftNoteReplyRow, type ShiftNoteRow } from '@/lib/db';
import { notifyShiftNoteReply } from '@/lib/notifications/shift-notes';
import {
  canReply,
  canSeeNote,
  canSeeReply,
  canTouchReply,
  normalizeEmail,
} from '@/lib/shift-notes/access';
import { normalizeReplyBody } from '@/lib/shift-notes/validate';
import { getPeopleNames } from '@/lib/sops/people';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Db = NonNullable<ReturnType<typeof getDb>>;

function viewerOf(gate: AdminGate) {
  return { email: normalizeEmail(gate.user.email), isAdmin: gate.access.isAdmin };
}

function peopleFor(...replies: ShiftNoteReplyRow[]) {
  return getPeopleNames(
    replies.flatMap((r) => [r.author_email ?? '', r.updated_by ?? '', r.data?.requested_by ?? ''])
  );
}

/** Parse a JSON body after the shared gate / origin / content-type checks. */
async function gated(
  cookies: Parameters<typeof requirePage>[0],
  request: Request
): Promise<{ gate: AdminGate; db: Db; email: string; body: Record<string, unknown> } | Response> {
  const gate = await requirePage(cookies, SHIFT_NOTES_HREF);
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }
  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);
  const email = normalizeEmail(gate.user.email);
  if (!email) return json({ error: 'Session has no email' }, 400);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  return { gate, db, email, body };
}

/**
 * The note a reply hangs off, for a caller who may see it. A note the caller
 * can't see reads as missing, the same way the notes route treats it.
 */
async function loadVisibleNote(
  db: Db,
  noteId: string,
  gate: AdminGate
): Promise<ShiftNoteRow | Response> {
  const { data, error } = await db.from('shift_notes').select('*').eq('id', noteId).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  const note = (data as ShiftNoteRow) ?? null;
  if (!note || !canSeeNote(note, viewerOf(gate))) return json({ error: 'Note not found' }, 404);
  return note;
}

/**
 * The reply `id` for a caller about to change it: 404 unless its note and
 * the reply itself are visible to them, 403 unless they may touch it.
 */
async function loadOwnReply(
  db: Db,
  id: string,
  gate: AdminGate
): Promise<ShiftNoteReplyRow | Response> {
  const { data, error } = await db
    .from('shift_note_replies')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  const reply = (data as ShiftNoteReplyRow) ?? null;
  if (!reply) return json({ error: 'Reply not found' }, 404);
  const note = await loadVisibleNote(db, reply.note_id, gate);
  if (note instanceof Response) return json({ error: 'Reply not found' }, 404);
  const viewer = viewerOf(gate);
  if (!canSeeReply(reply, viewer)) return json({ error: 'Reply not found' }, 404);
  if (reply.kind !== 'comment') {
    return json({ error: "A note's history can't be edited or deleted" }, 403);
  }
  if (!canTouchReply(reply, viewer)) {
    return json({ error: "Only the reply's author or an admin can change it" }, 403);
  }
  return reply;
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, SHIFT_NOTES_HREF);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const noteId = url.searchParams.get('noteId') ?? '';
  if (!UUID_RE.test(noteId)) return json({ error: 'noteId must be a UUID' }, 400);

  const note = await loadVisibleNote(db, noteId, gate);
  if (note instanceof Response) return note;

  const { data, error } = await db
    .from('shift_note_replies')
    .select('*')
    .eq('note_id', noteId)
    .order('created_at', { ascending: true });
  if (error) return json({ error: error.message }, 500);

  const viewer = viewerOf(gate);
  const replies = ((data ?? []) as ShiftNoteReplyRow[]).filter((r) => canSeeReply(r, viewer));
  return json({ replies, people: await peopleFor(...replies) });
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const ctx = await gated(cookies, request);
  if (ctx instanceof Response) return ctx;
  const { gate, db, email, body } = ctx;

  const noteId = typeof body.noteId === 'string' ? body.noteId : '';
  if (!UUID_RE.test(noteId)) return json({ error: 'noteId must be a UUID' }, 400);
  const replyBody = normalizeReplyBody(body.body);
  if (!replyBody) return json({ error: 'body must be non-empty text' }, 400);
  if (body.isPrivate !== undefined && typeof body.isPrivate !== 'boolean') {
    return json({ error: 'isPrivate must be a boolean' }, 400);
  }

  const note = await loadVisibleNote(db, noteId, gate);
  if (note instanceof Response) return note;
  const viewer = viewerOf(gate);
  if (!canReply(note, viewer)) return json({ error: 'Note not found' }, 404);

  // Only an admin can keep a reply among the admins.
  const isPrivate = viewer.isAdmin && body.isPrivate === true;

  const { data, error } = await db
    .from('shift_note_replies')
    .insert({ note_id: noteId, body: replyBody, author_email: email, is_private: isPrivate })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  const reply = data as ShiftNoteReplyRow;
  await notifyShiftNoteReply(db, note, reply);
  return json({ reply, people: await peopleFor(reply) }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const ctx = await gated(cookies, request);
  if (ctx instanceof Response) return ctx;
  const { gate, db, email, body } = ctx;

  const id = typeof body.id === 'string' ? body.id : '';
  if (!UUID_RE.test(id)) return json({ error: 'id must be a UUID' }, 400);

  const patch: Partial<Pick<ShiftNoteReplyRow, 'body' | 'is_private' | 'updated_by'>> = {};
  if (body.body !== undefined) {
    const replyBody = normalizeReplyBody(body.body);
    if (!replyBody) return json({ error: 'body must be non-empty text' }, 400);
    patch.body = replyBody;
  }
  if (body.isPrivate !== undefined) {
    if (typeof body.isPrivate !== 'boolean')
      return json({ error: 'isPrivate must be a boolean' }, 400);
    if (!gate.access.isAdmin) return json({ error: 'Only admins can make a reply private' }, 403);
    patch.is_private = body.isPrivate;
  }
  if (patch.body === undefined && patch.is_private === undefined) {
    return json({ error: 'Nothing to update' }, 400);
  }
  patch.updated_by = email;

  const existing = await loadOwnReply(db, id, gate);
  if (existing instanceof Response) return existing;

  const { data, error } = await db
    .from('shift_note_replies')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  const reply = data as ShiftNoteReplyRow;
  return json({ reply, people: await peopleFor(reply) });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const gate = await requirePage(cookies, SHIFT_NOTES_HREF);
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id') ?? '';
  if (!UUID_RE.test(id)) return json({ error: 'id must be a UUID' }, 400);

  const existing = await loadOwnReply(db, id, gate);
  if (existing instanceof Response) return existing;

  const { error } = await db.from('shift_note_replies').delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true });
};
