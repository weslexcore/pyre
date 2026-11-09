// The SOP video library (see the sop_videos migration and lib/sops/videos).
//
// GET lists the ready videos, newest first, each with the SOPs that
// reference it — for the picker in the SOP editor. Anyone with the
// /admin/sops page grant may list; only admins see the picker.
//
// POST is admin-only and drives an upload in two steps, because a
// walkthrough is far bigger than a serverless request body may be:
//
//   { action: 'start', fileName, mimeType, sizeBytes, title }
//     → records the video as 'uploading' and returns a signed upload URL the
//       browser sends the file to directly (valid two hours).
//   { action: 'complete', id }
//     → checks the object really landed in storage, within the limits, and
//       marks the video 'ready' so documents can play it.
//
// Uploads that never complete are cleared after a day (clearStaleUploads,
// run on each listing).

import type { APIRoute } from 'astro';
import { requireAdmin, requirePage } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import { dbError, gateMutation, isUuid, json, readJsonBody, sessionEmail } from '@/lib/http/route';
import {
  isSopVideoMime,
  MAX_SOP_VIDEO_BYTES,
  MAX_SOP_VIDEO_TITLE,
  normalizeMime,
  SOP_VIDEO_BUCKET,
  sopVideoStoragePath,
  titleFromFileName,
} from '@/lib/sops/videos';
import {
  clearStaleUploads,
  MAX_PENDING_UPLOADS,
  type SopVideoRow,
  toSopVideo,
  videoUsage,
} from '@/lib/sops/videos-server';

const PAGE = '/admin/sops';
const FILE_NAME_MAX = 200;
// The library is a handful of walkthroughs; this bounds the payload anyway.
const MAX_LISTED = 500;

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  await clearStaleUploads(db);

  const { data, error } = await db
    .from('sop_videos')
    .select('*')
    .eq('status', 'ready')
    .order('created_at', { ascending: false })
    .limit(MAX_LISTED);
  if (error) return dbError(error);

  const rows = (data ?? []) as SopVideoRow[];
  const usage = await videoUsage(
    db,
    rows.map((row) => row.id)
  );
  if ('error' in usage) return json({ error: usage.error }, 500);

  return json({ videos: rows.map((row) => toSopVideo(row, usage[row.id] ?? [])) });
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
    if (!isSopVideoMime(mime)) {
      return json({ error: 'Only MP4, WebM and MOV videos can be uploaded' }, 415);
    }
    const size = Number(body.sizeBytes);
    if (!Number.isInteger(size) || size <= 0) {
      return json({ error: 'sizeBytes must be a positive integer' }, 400);
    }
    if (size > MAX_SOP_VIDEO_BYTES) {
      return json(
        { error: `Videos can be ${Math.round(MAX_SOP_VIDEO_BYTES / 1_048_576)} MB at most` },
        413
      );
    }
    const fileName =
      (typeof body.fileName === 'string' ? body.fileName.trim() : '').slice(0, FILE_NAME_MAX) ||
      'video';
    const title =
      (typeof body.title === 'string' ? body.title.trim() : '').slice(0, MAX_SOP_VIDEO_TITLE) ||
      titleFromFileName(fileName);

    // An admin abandoning uploads mid-way shouldn't be able to pile up
    // reserved slots faster than the daily cleanup clears them.
    const { count, error: countError } = await db
      .from('sop_videos')
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
    const storagePath = sopVideoStoragePath(id, mime);

    const { data: signed, error: signError } = await db.storage
      .from(SOP_VIDEO_BUCKET)
      .createSignedUploadUrl(storagePath);
    if (signError || !signed) {
      return json({ error: `Could not start the upload: ${signError?.message ?? 'unknown'}` }, 502);
    }

    const { data, error } = await db
      .from('sop_videos')
      .insert({
        id,
        title,
        storage_path: storagePath,
        file_name: fileName,
        mime_type: mime,
        size_bytes: size,
        status: 'uploading',
        uploaded_by: email,
      })
      .select('*')
      .single();
    if (error) return dbError(error);

    return json({ id: (data as SopVideoRow).id, uploadUrl: signed.signedUrl }, 201);
  }

  if (body.action === 'complete') {
    if (!isUuid(body.id)) return json({ error: 'id must be a UUID' }, 400);

    const { data, error } = await db.from('sop_videos').select('*').eq('id', body.id).maybeSingle();
    if (error) return dbError(error);
    const row = (data as SopVideoRow) ?? null;
    if (!row) return json({ error: 'Video not found' }, 404);
    if (row.status === 'ready') return json({ video: toSopVideo(row, []) });

    // The browser says it is done; storage has the final word.
    const { data: info, error: infoError } = await db.storage
      .from(SOP_VIDEO_BUCKET)
      .info(row.storage_path);
    if (infoError || !info) {
      return json({ error: 'The upload has not reached storage yet' }, 409);
    }
    const size = Number(info.size ?? row.size_bytes);
    if (size > MAX_SOP_VIDEO_BYTES) {
      await db.storage.from(SOP_VIDEO_BUCKET).remove([row.storage_path]);
      await db.from('sop_videos').delete().eq('id', row.id);
      return json({ error: 'That video is over the size limit' }, 413);
    }

    const { data: updated, error: updateError } = await db
      .from('sop_videos')
      .update({ status: 'ready', size_bytes: size > 0 ? size : row.size_bytes })
      .eq('id', row.id)
      .select('*')
      .single();
    if (updateError) return dbError(updateError);

    return json({ video: toSopVideo(updated as SopVideoRow, []) });
  }

  return json({ error: "action must be 'start' or 'complete'" }, 400);
};
