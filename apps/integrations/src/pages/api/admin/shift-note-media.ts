// Photos and video backing shift notes.
//
// POST takes one file as multipart/form-data, puts it in the private
// shift-note-media bucket, and records a shift_note_attachments row. GET
// exchanges an attachment id for a short-lived signed URL — by default as a
// redirect, so an <img>/<video> src can point straight at this route and
// always get a fresh link. DELETE removes the object and its row.
//
// Nothing in the bucket is publicly readable: every read passes the same
// gate as the log itself. Permissions mirror the notes: everyone who can see
// /admin/shift-notes may view media; attaching and removing follow the note's
// own author-or-admin rule, the same check as editing its text. Uploads go
// through the function rather than a direct-to-storage signed URL so size,
// MIME type, and per-note count are all enforced server-side, and the
// attachment row and the object are created together.

import type { APIRoute } from 'astro';
import { SHIFT_NOTES_HREF } from '@/components/admin/adminTools';
import { type AdminGate, assertSameOrigin, requirePage } from '@/lib/auth/admin';
import { getDb, type ShiftNoteAttachmentRow, type ShiftNoteRow } from '@/lib/db';
import {
  buildNoteStoragePath,
  formatBytes,
  kindForMime,
  MAX_ATTACHMENTS_PER_NOTE,
  MAX_FILE_BYTES,
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

/** Same rule as editing the note itself (shift-notes.ts). */
function canTouch(note: ShiftNoteRow, gate: AdminGate): boolean {
  if (gate.access.isAdmin) return true;
  const email = (gate.user.email ?? '').trim().toLowerCase();
  return !!email && note.author_email === email;
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

  const noteId = String(form.get('noteId') ?? '');
  if (!UUID_RE.test(noteId)) return json({ error: 'noteId must be a UUID' }, 400);

  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'No file was uploaded' }, 400);

  const { data: noteData, error: noteError } = await db
    .from('shift_notes')
    .select('*')
    .eq('id', noteId)
    .maybeSingle();
  if (noteError) return json({ error: noteError.message }, 500);
  const note = (noteData as ShiftNoteRow) ?? null;
  if (!note) return json({ error: 'Note not found' }, 404);
  if (!canTouch(note, gate)) {
    return json({ error: 'Only the author or an admin may attach to a note' }, 403);
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

  const { count, error: countError } = await db
    .from('shift_note_attachments')
    .select('id', { count: 'exact', head: true })
    .eq('note_id', noteId);
  if (countError) return json({ error: countError.message }, 500);
  if ((count ?? 0) >= MAX_ATTACHMENTS_PER_NOTE) {
    return json({ error: `A note can hold ${MAX_ATTACHMENTS_PER_NOTE} attachments at most` }, 409);
  }

  const fileName = (file.name || `${kind}.bin`).slice(0, FILE_NAME_MAX);
  const storagePath = buildNoteStoragePath(noteId, fileName, file.type);

  const { error: uploadError } = await db.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    console.error('[shift-notes] upload failed:', uploadError.message);
    return json({ error: `Upload failed: ${uploadError.message}` }, 502);
  }

  const email = (gate.user.email ?? '').trim().toLowerCase();
  const { data, error } = await db
    .from('shift_note_attachments')
    .insert({
      note_id: noteId,
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

  // Everyone who can read the log can view its media — no per-note check.
  const { data, error } = await db
    .from('shift_note_attachments')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);

  const row = (data as ShiftNoteAttachmentRow) ?? null;
  if (!row) return json({ error: 'Attachment not found' }, 404);

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

  const { data: noteData, error: noteError } = await db
    .from('shift_notes')
    .select('*')
    .eq('id', attachment.note_id)
    .maybeSingle();
  if (noteError) return json({ error: noteError.message }, 500);
  const note = (noteData as ShiftNoteRow) ?? null;
  if (!note || !canTouch(note, gate)) {
    return json({ error: 'Only the author or an admin may remove an attachment' }, 403);
  }

  const { error: storageError } = await db.storage.from(BUCKET).remove([attachment.storage_path]);
  if (storageError) {
    console.error('[shift-notes] media delete failed:', storageError.message);
  }

  const { error: deleteError } = await db.from('shift_note_attachments').delete().eq('id', id);
  if (deleteError) return json({ error: deleteError.message }, 500);

  return json({ ok: true });
};
