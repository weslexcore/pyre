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
// belongs to the note it backs, so whoever can see a note can view its media,
// and whoever can edit it (the author, an admin) can attach and remove
// (lib/shift-notes/access). A staged row belongs to
// nobody's note yet, so it is reachable only by its uploader — admin reach
// starts once a note claims it. Uploads go through the function rather than
// a direct-to-storage signed URL so size, MIME type, and per-note count are
// all enforced server-side, and the attachment row and the object are
// created together.

import type { APIRoute } from 'astro';
import { SHIFT_NOTES_HREF } from '@/components/admin/adminTools';
import { type AdminGate, assertSameOrigin, requirePage } from '@/lib/auth/admin';
import { getDb, type ShiftNoteAttachmentRow, type ShiftNoteRow } from '@/lib/db';
import { normalizeEmail } from '@/lib/email/address';
import { dbError, isUuid, json } from '@/lib/http/route';
import {
  checkUpload,
  readUpload,
  removeStoredFile,
  signedAttachmentResponse,
  storeUpload,
} from '@/lib/media/route';
import { canEditNote, canSeeNote } from '@/lib/shift-notes/access';
import {
  buildNoteStoragePath,
  buildStagedStoragePath,
  MAX_ATTACHMENTS_PER_NOTE,
  MAX_STAGED_PER_UPLOADER,
} from '@/lib/shift-notes/media';

const BUCKET = 'shift-note-media';

/** Original names come from phone cameras and can be anything; keep them sane. */
const FILE_NAME_MAX = 200;

/** Viewing a note's media, or changing it (attaching, removing). */
type Reach = 'see' | 'edit';

/**
 * The note `noteId` backs, if this caller may reach it for `reach`. Same
 * rules as reading and editing the note itself (shift-notes.ts), and the same
 * silence about notes they can't see: not visible reads as not there.
 */
async function loadNote(
  db: NonNullable<ReturnType<typeof getDb>>,
  noteId: string,
  gate: AdminGate,
  reach: Reach
): Promise<ShiftNoteRow | Response> {
  const { data, error } = await db.from('shift_notes').select('*').eq('id', noteId).maybeSingle();
  if (error) return dbError(error);

  const note = (data as ShiftNoteRow) ?? null;
  const viewer = { email: normalizeEmail(gate.user.email), isAdmin: gate.access.isAdmin };
  if (!note || !canSeeNote(note, viewer)) return json({ error: 'Note not found' }, 404);
  if (reach === 'edit' && !canEditNote(note, viewer)) {
    return json({ error: "Only the note's author or an admin can change its files" }, 403);
  }
  return note;
}

/**
 * Whether this caller may reach `row` for `reach` (signing is 'see',
 * deleting is 'edit'). Claimed media takes its note's own rules; a staged row (note_id null) is a private
 * composer-session thing, reachable only by whoever uploaded it — with the
 * usual silence: not yours reads as not there.
 */
async function assertCanReachAttachment(
  db: NonNullable<ReturnType<typeof getDb>>,
  row: ShiftNoteAttachmentRow,
  gate: AdminGate,
  reach: Reach
): Promise<Response | null> {
  if (row.note_id === null) {
    if (row.uploaded_by !== normalizeEmail(gate.user.email)) {
      return json({ error: 'Attachment not found' }, 404);
    }
    return null;
  }
  const note = await loadNote(db, row.note_id, gate, reach);
  return note instanceof Response ? note : null;
}

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, SHIFT_NOTES_HREF);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const form = await readUpload(request);
  if (form instanceof Response) return form;

  // No noteId means a staged upload: the composer sends files as soon as
  // they're picked, before the note exists to attach them to.
  const noteId = String(form.get('noteId') ?? '');
  if (noteId && !isUuid(noteId)) return json({ error: 'noteId must be a UUID' }, 400);

  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'No file was uploaded' }, 400);

  const email = normalizeEmail(gate.user.email);
  if (!email) return json({ error: 'Session has no email' }, 400);

  if (noteId) {
    const note = await loadNote(db, noteId, gate, 'edit');
    if (note instanceof Response) return note;
  }

  const kind = checkUpload(file);
  if (kind instanceof Response) return kind;

  if (noteId) {
    const { count, error: countError } = await db
      .from('shift_note_attachments')
      .select('id', { count: 'exact', head: true })
      .eq('note_id', noteId);
    if (countError) return dbError(countError);
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
    if (countError) return dbError(countError);
    if ((count ?? 0) >= MAX_STAGED_PER_UPLOADER) {
      return json({ error: 'Too many unattached uploads — add a note or remove some files' }, 409);
    }
  }

  const fileName = (file.name || `${kind}.bin`).slice(0, FILE_NAME_MAX);
  const storagePath = noteId
    ? buildNoteStoragePath(noteId, fileName, file.type)
    : buildStagedStoragePath(fileName, file.type);

  const attachment = await storeUpload<ShiftNoteAttachmentRow>(
    db,
    { bucket: BUCKET, path: storagePath, file, scope: 'shift-notes' },
    () =>
      db
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
        .single()
  );
  if (attachment instanceof Response) return attachment;

  return json({ attachment }, 201);
};

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, SHIFT_NOTES_HREF);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id || !isUuid(id)) return json({ error: 'id must be a UUID' }, 400);

  const { data, error } = await db
    .from('shift_note_attachments')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return dbError(error);

  const row = (data as ShiftNoteAttachmentRow) ?? null;
  if (!row) return json({ error: 'Attachment not found' }, 404);

  // Media is only as visible as the note it backs (or, staged, as its
  // uploader): signing a URL here is a read, so it takes the same check.
  const denied = await assertCanReachAttachment(db, row, gate, 'see');
  if (denied) return denied;

  return signedAttachmentResponse(db, BUCKET, row, url);
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const gate = await requirePage(cookies, SHIFT_NOTES_HREF);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id || !isUuid(id)) return json({ error: 'id must be a UUID' }, 400);

  const { data, error } = await db
    .from('shift_note_attachments')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return dbError(error);

  const attachment = (data as ShiftNoteAttachmentRow) ?? null;
  if (!attachment) return json({ error: 'Attachment not found' }, 404);

  const denied = await assertCanReachAttachment(db, attachment, gate, 'edit');
  if (denied) return denied;

  await removeStoredFile(db, BUCKET, attachment.storage_path, 'shift-notes');

  const { error: deleteError } = await db.from('shift_note_attachments').delete().eq('id', id);
  if (deleteError) return dbError(deleteError);

  return json({ ok: true });
};
