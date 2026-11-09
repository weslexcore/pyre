// The SOP media library: images and video walkthroughs (see the sop_media
// migration and lib/sops/media).
//
// GET lists the ready files, newest first, each with the SOPs that reference
// it, for the picker in the SOP editor. ?kind=image|video narrows it. Anyone
// with the /admin/sops page grant may list; only admins see the picker.
//
// POST is admin-only and drives an upload in two steps, because a
// walkthrough is far bigger than a serverless request body may be:
//
//   { action: 'start', fileName, mimeType, sizeBytes, title }
//     → records the file as 'uploading' (its kind taken from the type) and
//       returns a signed upload URL the browser sends the file to directly
//       (valid two hours).
//   { action: 'complete', id }
//     → checks the object really landed in storage, within the limits, and
//       marks it 'ready' so documents can show it.
//
// Uploads that never complete are cleared after a day (clearStaleUploads,
// run on each listing). Each file is then served, renamed and deleted at
// /api/admin/sop-images/<id> or /api/admin/sop-videos/<id>.

import type { APIRoute } from 'astro';
import { requireAdmin, requirePage } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import { dbError, gateMutation, isUuid, json, readJsonBody, sessionEmail } from '@/lib/http/route';
import {
  formatMegabytes,
  kindForMime,
  MAX_SOP_MEDIA_BYTES,
  MAX_SOP_MEDIA_TITLE,
  normalizeMime,
  SOP_MEDIA_BUCKET,
  SOP_MEDIA_KINDS,
  type SopMediaKind,
  sopMediaStoragePath,
  titleFromFileName,
} from '@/lib/sops/media';
import {
  clearStaleUploads,
  MAX_PENDING_UPLOADS,
  mediaUsage,
  type SopMediaRow,
  toSopMedia,
} from '@/lib/sops/media-server';

const PAGE = '/admin/sops';
const FILE_NAME_MAX = 200;
// The library is a few dozen files; this bounds the payload anyway.
const MAX_LISTED = 500;

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const kind = url.searchParams.get('kind');
  if (kind && !(SOP_MEDIA_KINDS as readonly string[]).includes(kind)) {
    return json({ error: "kind must be 'image' or 'video'" }, 400);
  }

  await clearStaleUploads(db);

  let query = db
    .from('sop_media')
    .select('*')
    .eq('status', 'ready')
    .order('created_at', { ascending: false })
    .limit(MAX_LISTED);
  if (kind) query = query.eq('kind', kind as SopMediaKind);
  const { data, error } = await query;
  if (error) return dbError(error);

  const rows = (data ?? []) as SopMediaRow[];
  const usage = await mediaUsage(
    db,
    rows.map((row) => row.id)
  );
  if ('error' in usage) return json({ error: usage.error }, 500);

  return json({ media: rows.map((row) => toSopMedia(row, usage[row.id] ?? [])) });
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await gateMutation(cookies, request, requireAdmin);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const email = sessionEmail(gate);
  if (!email) return json({ error: 'Session has no email' }, 400);

  if (body.action === 'start') {
    const mime = normalizeMime(typeof body.mimeType === 'string' ? body.mimeType : '');
    const kind = kindForMime(mime);
    if (!kind) {
      return json(
        { error: 'Only JPEG, PNG, WebP or GIF images and MP4, WebM or MOV videos can be uploaded' },
        415
      );
    }
    const size = Number(body.sizeBytes);
    if (!Number.isInteger(size) || size <= 0) {
      return json({ error: 'sizeBytes must be a positive integer' }, 400);
    }
    if (size > MAX_SOP_MEDIA_BYTES[kind]) {
      return json(
        {
          error: `${kind === 'image' ? 'Images' : 'Videos'} can be ${formatMegabytes(MAX_SOP_MEDIA_BYTES[kind])} at most`,
        },
        413
      );
    }
    const fileName =
      (typeof body.fileName === 'string' ? body.fileName.trim() : '').slice(0, FILE_NAME_MAX) ||
      kind;
    const title =
      (typeof body.title === 'string' ? body.title.trim() : '').slice(0, MAX_SOP_MEDIA_TITLE) ||
      titleFromFileName(fileName);

    // An admin abandoning uploads mid-way shouldn't be able to pile up
    // reserved slots faster than the daily cleanup clears them.
    const { count, error: countError } = await db
      .from('sop_media')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'uploading')
      .eq('uploaded_by', email);
    if (countError) return dbError(countError);
    if ((count ?? 0) >= MAX_PENDING_UPLOADS) {
      return json(
        { error: 'Too many unfinished uploads — wait for them, or try again later' },
        409
      );
    }

    const id = crypto.randomUUID();
    const storagePath = sopMediaStoragePath(id, mime);

    const { data: signed, error: signError } = await db.storage
      .from(SOP_MEDIA_BUCKET)
      .createSignedUploadUrl(storagePath);
    if (signError || !signed) {
      return json({ error: `Could not start the upload: ${signError?.message ?? 'unknown'}` }, 502);
    }

    const { error } = await db.from('sop_media').insert({
      id,
      kind,
      title,
      storage_path: storagePath,
      file_name: fileName,
      mime_type: mime,
      size_bytes: size,
      status: 'uploading',
      uploaded_by: email,
    });
    if (error) return dbError(error);

    return json({ id, kind, uploadUrl: signed.signedUrl }, 201);
  }

  if (body.action === 'complete') {
    if (!isUuid(body.id)) return json({ error: 'id must be a UUID' }, 400);

    const { data, error } = await db.from('sop_media').select('*').eq('id', body.id).maybeSingle();
    if (error) return dbError(error);
    const row = (data as SopMediaRow) ?? null;
    if (!row) return json({ error: 'Upload not found' }, 404);
    if (row.status === 'ready') return json({ media: toSopMedia(row, []) });

    // The browser says it is done; storage has the final word.
    const { data: info, error: infoError } = await db.storage
      .from(SOP_MEDIA_BUCKET)
      .info(row.storage_path);
    if (infoError || !info) {
      return json({ error: 'The upload has not reached storage yet' }, 409);
    }
    const size = Number(info.size ?? row.size_bytes);
    if (size > MAX_SOP_MEDIA_BYTES[row.kind]) {
      await db.storage.from(SOP_MEDIA_BUCKET).remove([row.storage_path]);
      await db.from('sop_media').delete().eq('id', row.id);
      return json({ error: 'That file is over the size limit' }, 413);
    }

    const { data: updated, error: updateError } = await db
      .from('sop_media')
      .update({ status: 'ready', size_bytes: size > 0 ? size : row.size_bytes })
      .eq('id', row.id)
      .select('*')
      .single();
    if (updateError) return dbError(updateError);

    return json({ media: toSopMedia(updated as SopMediaRow, []) });
  }

  return json({ error: "action must be 'start' or 'complete'" }, 400);
};
