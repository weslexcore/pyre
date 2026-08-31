// Photos and video backing shift notes.
//
// POST takes one file as multipart/form-data, puts it in the private
// shift-note-media bucket, and records a shift_note_attachments row. With a
// noteId the file attaches to that note; without one it is *staged* — the
// composer uploads eagerly while the note is still being written, and the
// note claims its staged rows (by id) when it is created. GET exchanges an
// attachment id for a short-lived signed URL — by default as a redirect, so
// an <img>/<video> src can point straight at this route and always get a
// fresh link. DELETE removes the object and its row.
//
// Nothing in the bucket is publicly readable: every read passes the same
// gate as the log itself. Permissions mirror the notes exactly — media
// belongs to the note it backs, so an admin reaches all of it and everyone
// else only what hangs off their own notes, for viewing as much as for
// attaching and removing (lib/shift-notes/access). A staged row belongs to
// nobody's note yet, so it is reachable only by its uploader — admin reach
// starts once a note claims it. Uploads go through the function rather than
// a direct-to-storage signed URL so size, MIME type, and per-note count are
// all enforced server-side, and the attachment row and the object are
// created together.

import type { APIRoute } from 'astro';
import { SHIFT_NOTES_HREF } from '@/components/admin/adminTools';
import { type AdminGate, assertSameOrigin, requirePage } from '@/lib/auth/admin';
import { getDb, type ShiftNoteAttachmentRow, type ShiftNoteRow } from '@/lib/db';
import { canSeeNote, normalizeEmail } from '@/lib/shift-notes/access';
import {
  buildNoteStoragePath,
  buildStagedStoragePath,
  formatBytes,
  kindForMime,
  MAX_ATTACHMENTS_PER_NOTE,
  MAX_FILE_BYTES,
  MAX_STAGED_PER_UPLOADER,
} from '@/lib/shift-notes/media';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const BUCKET = 'shift-note-media';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Long enough to load a page of media, short enough that a leaked link dies. */
const SIGNED_URL_TTL_SECONDS = 600;

/** Original names come from phone cameras and can be anything; keep them sane. */
const FILE_NAME_MAX = 200;

/**
 * The note `noteId` backs, if this caller may reach it at all. Same rule as
 * reading and editing the note itself (shift-notes.ts), and the same silence
 * about other people's notes: not theirs reads as not there.
 */
async function loadOwnNote(
  db: NonNullable<ReturnType<typeof getDb>>,
  noteId: string,
  gate: AdminGate
): Promise<ShiftNoteRow | Response> {
  const { data, error } = await db.from('shift_notes').select('*').eq('id', noteId).maybeSingle();
  if (error) return json({ error: error.message }, 500);

  const note = (data as ShiftNoteRow) ?? null;
  const viewer = { email: normalizeEmail(gate.user.email), isAdmin: gate.access.isAdmin };
  if (!note || !canSeeNote(note, viewer)) return json({ error: 'Note not found' }, 404);
  return note;
}

/**
 * Whether this caller may reach `row` at all (for signing, deleting). Claimed
 * media takes its note's own rule; a staged row (note_id null) is a private
 * composer-session thing, reachable only by whoever uploaded it — with the
 * usual silence: not yours reads as not there.
 */
async function assertCanReachAttachment(
  db: NonNullable<ReturnType<typeof getDb>>,
  row: ShiftNoteAttachmentRow,
  gate: AdminGate
): Promise<Response | null> {
  if (row.note_id === null) {
    if (row.uploaded_by !== normalizeEmail(gate.user.email)) {
      return json({ error: 'Attachment not found' }, 404);
    }
    return null;
  }
  const note = await loadOwnNote(db, row.note_id, gate);
  return note instanceof Response ? note : null;
}

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, SHIFT_NOTES_HREF);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  if (!request.headers.get('content-type')?.includes('multipart/form-data')) {
    return json({ error: 'Content-Type must be multipart/form-data' }, 415);
  }

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Could not read the upload' }, 400);
  }

  // No noteId means a staged upload: the composer sends files as soon as
  // they're picked, before the note exists to attach them to.
  const noteId = String(form.get('noteId') ?? '');
  if (noteId && !UUID_RE.test(noteId)) return json({ error: 'noteId must be a UUID' }, 400);

  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'No file was uploaded' }, 400);

  const email = normalizeEmail(gate.user.email);
  if (!email) return json({ error: 'Session has no email' }, 400);

  if (noteId) {
    const note = await loadOwnNote(db, noteId, gate);
    if (note instanceof Response) return note;
  }

  const kind = kindForMime(file.type);
  if (!kind) return json({ error: `Unsupported file type: ${file.type || 'unknown'}` }, 415);
  if (file.size === 0) return json({ error: 'That file is empty' }, 400);
  if (file.size > MAX_FILE_BYTES) {
    return json(
      {
        error: `That file is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_FILE_BYTES)}`,
      },
      413
    );
  }

  if (noteId) {
    const { count, error: countError } = await db
      .from('shift_note_attachments')
      .select('id', { count: 'exact', head: true })
      .eq('note_id', noteId);
    if (countError) return json({ error: countError.message }, 500);
    if ((count ?? 0) >= MAX_ATTACHMENTS_PER_NOTE) {
      return json(
        { error: `A note can hold ${MAX_ATTACHMENTS_PER_NOTE} attachments at most` },
        409
      );
    }
  } else {
    // Staged uploads have no note to cap against yet (the claim enforces the
    // per-note cap); cap the person instead so abandoning composers can't
    // pile up unbounded 50 MB objects faster than the daily sweep clears them.
    const { count, error: countError } = await db
      .from('shift_note_attachments')
      .select('id', { count: 'exact', head: true })
      .is('note_id', null)
      .eq('uploaded_by', email);
    if (countError) return json({ error: countError.message }, 500);
    if ((count ?? 0) >= MAX_STAGED_PER_UPLOADER) {
      return json({ error: 'Too many unattached uploads — add a note or remove some files' }, 409);
    }
  }

  const fileName = (file.name || `${kind}.bin`).slice(0, FILE_NAME_MAX);
  const storagePath = noteId
    ? buildNoteStoragePath(noteId, fileName, file.type)
    : buildStagedStoragePath(fileName, file.type);

  const { error: uploadError } = await db.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    console.error('[shift-notes] upload failed:', uploadError.message);
    return json({ error: `Upload failed: ${uploadError.message}` }, 502);
  }

  const { data, error } = await db
    .from('shift_note_attachments')
    .insert({
      note_id: noteId || null,
      storage_path: storagePath,
      file_name: fileName,
      mime_type: file.type,
      size_bytes: file.size,
      kind,
      uploaded_by: email,
    })
    .select('*')
    .single();

  if (error) {
    // Don't leave an orphan object behind when the row fails.
    await db.storage.from(BUCKET).remove([storagePath]);
    return json({ error: error.message }, 500);
  }

  return json({ attachment: data as ShiftNoteAttachmentRow }, 201);
};

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, SHIFT_NOTES_HREF);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id || !UUID_RE.test(id)) return json({ error: 'id must be a UUID' }, 400);

  const { data, error } = await db
    .from('shift_note_attachments')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);

  const row = (data as ShiftNoteAttachmentRow) ?? null;
  if (!row) return json({ error: 'Attachment not found' }, 404);

  // Media is only as visible as the note it backs (or, staged, as its
  // uploader): signing a URL here is a read, so it takes the same check.
  const denied = await assertCanReachAttachment(db, row, gate);
  if (denied) return denied;

  const { data: signed, error: signError } = await db.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS, {
      download: url.searchParams.get('download') === '1' ? row.file_name : undefined,
    });
  if (signError || !signed?.signedUrl) {
    return json({ error: signError?.message ?? 'Could not sign that file' }, 502);
  }

  if (url.searchParams.get('format') === 'json') {
    return json({ url: signed.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS, attachment: row });
  }

  // Default: bounce straight to the object, so an <img>/<video> src can be
  // this route and never hold a stale signature.
  return new Response(null, {
    status: 302,
    headers: { Location: signed.signedUrl, 'Cache-Control': 'private, no-store' },
  });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const gate = await requirePage(cookies, SHIFT_NOTES_HREF);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id || !UUID_RE.test(id)) return json({ error: 'id must be a UUID' }, 400);

  const { data, error } = await db
    .from('shift_note_attachments')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);

  const attachment = (data as ShiftNoteAttachmentRow) ?? null;
  if (!attachment) return json({ error: 'Attachment not found' }, 404);

  const denied = await assertCanReachAttachment(db, attachment, gate);
  if (denied) return denied;

  const { error: storageError } = await db.storage.from(BUCKET).remove([attachment.storage_path]);
  if (storageError) {
    console.error('[shift-notes] media delete failed:', storageError.message);
  }

  const { error: deleteError } = await db.from('shift_note_attachments').delete().eq('id', id);
  if (deleteError) return json({ error: deleteError.message }, 500);

  return json({ ok: true });
};
