// Shift notes: the running log behind /admin/shift-notes where the person
// leading a shift writes down how it went. Everyone who can see the page —
// admins, shift leads (implicit grant in lib/auth/access), and anyone granted
// the page from /admin/users — reads the whole log and may add notes; editing
// and deleting a note is author-or-admin. Author identity always comes from
// the session, never the request body.
//
// Photos/video backing a note are handled by shift-note-media.ts; GET here
// returns each note's attachment rows so the log renders in one request.
//
//   GET                          → { notes, attachments, people, viewer }
//   POST   { noteDate, body }    → { note, people }
//   PATCH  { id, noteDate?, body? } → { note, people }
//   DELETE ?id=<uuid>            → { ok: true }

import type { APIRoute } from 'astro';
import { SHIFT_NOTES_HREF } from '@/components/admin/adminTools';
import { type AdminGate, assertSameOrigin, requirePage } from '@/lib/auth/admin';
import { getDb, type ShiftNoteAttachmentRow, type ShiftNoteRow } from '@/lib/db';
import { isNoteDate, normalizeBody } from '@/lib/shift-notes/validate';
import { getPeopleNames } from '@/lib/sops/people';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The log is young and notes are short; a cap this size is years of shifts.
// Revisit with paging if the page ever feels heavy.
const LIST_LIMIT = 500;

/** The name directory for everyone a set of notes mentions. */
function peopleFor(notes: ShiftNoteRow[]) {
  return getPeopleNames(notes.flatMap((n) => [n.author_email, n.updated_by ?? '']));
}

/** Whether the caller may edit or delete this note. */
function canTouch(note: ShiftNoteRow, gate: AdminGate): boolean {
  if (gate.access.isAdmin) return true;
  const email = (gate.user.email ?? '').trim().toLowerCase();
  return !!email && note.author_email === email;
}

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requirePage(cookies, SHIFT_NOTES_HREF);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const { data, error } = await db
    .from('shift_notes')
    .select('*')
    .order('note_date', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(LIST_LIMIT);
  if (error) return json({ error: error.message }, 500);

  const notes = (data ?? []) as ShiftNoteRow[];

  // Each note's media, keyed by note id, in upload order.
  const attachments: Record<string, ShiftNoteAttachmentRow[]> = {};
  if (notes.length > 0) {
    const { data: rows, error: attachError } = await db
      .from('shift_note_attachments')
      .select('*')
      .in(
        'note_id',
        notes.map((n) => n.id)
      )
      .order('created_at', { ascending: true });
    if (attachError) return json({ error: attachError.message }, 500);
    for (const row of (rows ?? []) as ShiftNoteAttachmentRow[]) {
      const group = attachments[row.note_id];
      if (group) group.push(row);
      else attachments[row.note_id] = [row];
    }
  }

  return json({
    notes,
    attachments,
    people: await peopleFor(notes),
    // So the island knows which notes to offer edit/delete on. The buttons
    // are UX only — every mutation re-checks author-or-admin here.
    viewer: {
      email: (gate.user.email ?? '').trim().toLowerCase(),
      isAdmin: gate.access.isAdmin,
    },
  });
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, SHIFT_NOTES_HREF);
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

  if (!isNoteDate(body.noteDate)) {
    return json({ error: 'noteDate must be a YYYY-MM-DD date' }, 400);
  }
  const noteBody = normalizeBody(body.body);
  if (!noteBody) return json({ error: 'body must be non-empty text' }, 400);

  const { data, error } = await db
    .from('shift_notes')
    .insert({ note_date: body.noteDate, body: noteBody, author_email: email })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  const note = data as ShiftNoteRow;
  return json({ note, people: await peopleFor([note]) }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, SHIFT_NOTES_HREF);
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

  const id = typeof body.id === 'string' ? body.id : '';
  if (!UUID_RE.test(id)) return json({ error: 'id must be a UUID' }, 400);

  const patch: Partial<Pick<ShiftNoteRow, 'note_date' | 'body' | 'updated_by'>> = {};
  if (body.noteDate !== undefined) {
    if (!isNoteDate(body.noteDate)) {
      return json({ error: 'noteDate must be a YYYY-MM-DD date' }, 400);
    }
    patch.note_date = body.noteDate;
  }
  if (body.body !== undefined) {
    const noteBody = normalizeBody(body.body);
    if (!noteBody) return json({ error: 'body must be non-empty text' }, 400);
    patch.body = noteBody;
  }
  if (patch.note_date === undefined && patch.body === undefined) {
    return json({ error: 'Nothing to update' }, 400);
  }
  patch.updated_by = email;

  const { data: existing, error: fetchError } = await db
    .from('shift_notes')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) return json({ error: fetchError.message }, 500);
  if (!existing) return json({ error: 'Note not found' }, 404);
  if (!canTouch(existing as ShiftNoteRow, gate)) {
    return json({ error: 'Only the author or an admin may edit a note' }, 403);
  }

  const { data, error } = await db
    .from('shift_notes')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  const note = data as ShiftNoteRow;
  return json({ note, people: await peopleFor([note]) });
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

  const { data: existing, error: fetchError } = await db
    .from('shift_notes')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) return json({ error: fetchError.message }, 500);
  if (!existing) return json({ error: 'Note not found' }, 404);
  if (!canTouch(existing as ShiftNoteRow, gate)) {
    return json({ error: 'Only the author or an admin may delete a note' }, 403);
  }

  // Deleting the note cascades its attachment rows, but the objects in the
  // bucket only go away if we remove them ourselves. Best-effort: a stranded
  // object is unreachable (nothing signs URLs for it) and costs pennies,
  // while failing the whole delete over storage would strand the note.
  const { data: media } = await db
    .from('shift_note_attachments')
    .select('storage_path')
    .eq('note_id', id);
  const paths = ((media ?? []) as { storage_path: string }[]).map((m) => m.storage_path);
  if (paths.length > 0) {
    const { error: storageError } = await db.storage.from('shift-note-media').remove(paths);
    if (storageError) {
      console.error('[shift-notes] media cleanup failed:', storageError.message);
    }
  }

  const { error } = await db.from('shift_notes').delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true });
};
