// Shift notes: the running log behind /admin/shift-notes where whoever worked
// a shift writes down how it went. Everyone who can see the page — admins,
// everyone active on the roster (implicit grant in lib/auth/access), and
// anyone granted the page from /admin/users — may add notes. What they read
// back splits by role: an admin sees every note, everyone else sees only the
// ones they wrote, and editing and deleting follow the same line
// (lib/shift-notes/access). Author identity always comes from the session,
// never the request body.
//
// Photos/video backing a note are handled by shift-note-media.ts; GET here
// returns each note's attachment rows so the log renders in one request. The
// composer uploads files eagerly (staged rows with a null note_id, see the
// media route); POST claims them by id once the note exists, and GET sweeps
// staged rows nobody claimed within a day.
//
//   GET                          → { notes, attachments, people, viewer, scope }
//   POST   { noteDate, body, attachmentIds? } → { note, attachments, people }
//   PATCH  { id, noteDate?, body? } → { note, people }
//   DELETE ?id=<uuid>            → { ok: true }

import type { APIRoute } from 'astro';
import { SHIFT_NOTES_HREF } from '@/components/admin/adminTools';
import { type AdminGate, assertSameOrigin, requirePage } from '@/lib/auth/admin';
import { getDb, type ShiftNoteAttachmentRow, type ShiftNoteRow } from '@/lib/db';
import { canSeeNote, normalizeEmail } from '@/lib/shift-notes/access';
import { MAX_ATTACHMENTS_PER_NOTE } from '@/lib/shift-notes/media';
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

// Staged uploads nobody claimed within a day are abandoned composer sessions.
const STAGED_TTL_MS = 24 * 60 * 60 * 1000;
const SWEEP_BATCH = 50;

/**
 * Best-effort cleanup of abandoned staged uploads (any uploader): objects
 * first, rows second, so a failure never strands an unreachable object with
 * no row pointing at it. Runs on every log load; errors are logged and
 * swallowed — the log must render regardless.
 */
async function sweepStagedAttachments(db: NonNullable<ReturnType<typeof getDb>>): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - STAGED_TTL_MS).toISOString();
    const { data, error } = await db
      .from('shift_note_attachments')
      .select('id, storage_path')
      .is('note_id', null)
      .lt('created_at', cutoff)
      .limit(SWEEP_BATCH);
    if (error || !data || data.length === 0) {
      if (error) console.error('[shift-notes] staged sweep query failed:', error.message);
      return;
    }
    const stale = data as { id: string; storage_path: string }[];
    const { error: storageError } = await db.storage
      .from('shift-note-media')
      .remove(stale.map((row) => row.storage_path));
    if (storageError) {
      console.error('[shift-notes] staged sweep storage remove failed:', storageError.message);
      return;
    }
    const { error: deleteError } = await db
      .from('shift_note_attachments')
      .delete()
      .in(
        'id',
        stale.map((row) => row.id)
      );
    if (deleteError) {
      console.error('[shift-notes] staged sweep row delete failed:', deleteError.message);
    }
  } catch (e) {
    console.error('[shift-notes] staged sweep failed:', e);
  }
}

/** The name directory for everyone a set of notes mentions. */
function peopleFor(notes: ShiftNoteRow[]) {
  return getPeopleNames(notes.flatMap((n) => [n.author_email, n.updated_by ?? '']));
}

/** The viewer this gate represents, in the shape the access rule reads. */
function viewerOf(gate: AdminGate) {
  return { email: normalizeEmail(gate.user.email), isAdmin: gate.access.isAdmin };
}

/**
 * Load the note `id` for a caller who is about to change it. Non-admins can't
 * see other people's notes at all, so one that isn't theirs comes back the
 * same way a nonexistent one does — a 403 here would confirm it exists.
 */
async function loadOwnNote(
  db: NonNullable<ReturnType<typeof getDb>>,
  id: string,
  gate: AdminGate
): Promise<ShiftNoteRow | Response> {
  const { data, error } = await db.from('shift_notes').select('*').eq('id', id).maybeSingle();
  if (error) return json({ error: error.message }, 500);

  const note = (data as ShiftNoteRow) ?? null;
  if (!note || !canSeeNote(note, viewerOf(gate))) return json({ error: 'Note not found' }, 404);
  return note;
}

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requirePage(cookies, SHIFT_NOTES_HREF);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  // Awaited, not fire-and-forget — a serverless runtime may freeze the
  // instance the moment the response goes out.
  await sweepStagedAttachments(db);

  const viewer = viewerOf(gate);

  let query = db
    .from('shift_notes')
    .select('*')
    .order('note_date', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(LIST_LIMIT);

  // Admins read the whole log; everyone else reads what they wrote. A session
  // without an email can't have written anything, so it reads nothing.
  if (!viewer.isAdmin) query = query.eq('author_email', viewer.email);

  const { data, error } = await query;
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
      if (!row.note_id) continue; // staged rows never match the .in() filter
      const group = attachments[row.note_id];
      if (group) group.push(row);
      else attachments[row.note_id] = [row];
    }
  }

  return json({
    notes,
    attachments,
    people: await peopleFor(notes),
    // So the island knows whether it is showing the whole log or just this
    // person's, and which notes to offer edit/delete on. Both are UX only —
    // every read and every mutation re-checks the same rule here.
    viewer,
    scope: viewer.isAdmin ? 'all' : 'mine',
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

  const email = normalizeEmail(gate.user.email);
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

  // Staged uploads (media route, null note_id) this note should claim.
  let attachmentIds: string[] = [];
  if (body.attachmentIds !== undefined) {
    if (
      !Array.isArray(body.attachmentIds) ||
      body.attachmentIds.some((id) => typeof id !== 'string' || !UUID_RE.test(id))
    ) {
      return json({ error: 'attachmentIds must be an array of UUIDs' }, 400);
    }
    attachmentIds = [...new Set(body.attachmentIds as string[])];
    if (attachmentIds.length > MAX_ATTACHMENTS_PER_NOTE) {
      return json(
        { error: `A note can hold ${MAX_ATTACHMENTS_PER_NOTE} attachments at most` },
        400
      );
    }
  }

  const { data, error } = await db
    .from('shift_notes')
    .insert({ note_date: body.noteDate, body: noteBody, author_email: email })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  const note = data as ShiftNoteRow;

  // Claim in one guarded update: only rows that are still staged and were
  // uploaded by this same person. Anything else — already claimed, swept,
  // someone else's id — is skipped rather than failing the POST; the note
  // and its text are safe either way, and the client compares what came
  // back against what it sent.
  let claimed: ShiftNoteAttachmentRow[] = [];
  if (attachmentIds.length > 0) {
    const { data: rows, error: claimError } = await db
      .from('shift_note_attachments')
      .update({ note_id: note.id })
      .in('id', attachmentIds)
      .is('note_id', null)
      .eq('uploaded_by', email)
      .select('*');
    if (claimError) {
      console.error('[shift-notes] attachment claim failed:', claimError.message);
    } else {
      // Same upload order the log renders in.
      claimed = ((rows ?? []) as ShiftNoteAttachmentRow[]).sort((a, b) =>
        a.created_at.localeCompare(b.created_at)
      );
    }
  }

  return json({ note, attachments: claimed, people: await peopleFor([note]) }, 201);
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

  const email = normalizeEmail(gate.user.email);
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

  const existing = await loadOwnNote(db, id, gate);
  if (existing instanceof Response) return existing;

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

  const existing = await loadOwnNote(db, id, gate);
  if (existing instanceof Response) return existing;

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
