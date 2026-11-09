// Server half of SOP media (see lib/sops/media and the sop_media migration):
// loading the library with where each file is used, clearing uploads that
// were started and never finished, and the per-file handlers that the
// /api/admin/sop-images/<id> and /api/admin/sop-videos/<id> routes share.
// Server-only.

import type { APIRoute } from 'astro';
import { requireAdmin, requirePage } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import { type Db, dbError, gateMutation, isUuid, json, readJsonBody } from '@/lib/http/route';
import { removeStoredFile, signedAttachmentResponse } from '@/lib/media/route';
import {
  MAX_SOP_MEDIA_TITLE,
  SOP_MEDIA_BUCKET,
  type SopMedia,
  type SopMediaKind,
  sopMediaIdsIn,
} from './media';

const PAGE = '/admin/sops';

export interface SopMediaRow {
  id: string;
  kind: SopMediaKind;
  title: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  status: 'uploading' | 'ready';
  uploaded_by: string;
  created_at: string;
  updated_at: string;
}

/** An upload still unconfirmed after this long was abandoned. */
export const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;

/** Most unfinished uploads one admin may hold at once. */
export const MAX_PENDING_UPLOADS = 5;

/**
 * Every SOP that references `ids`, keyed by file id. Read from the current
 * text of each document, so it is what a reader sees today.
 */
export async function mediaUsage(
  db: Db,
  ids: string[]
): Promise<Record<string, { slug: string; title: string }[]> | { error: string }> {
  const usage: Record<string, { slug: string; title: string }[]> = {};
  for (const id of ids) usage[id] = [];
  if (ids.length === 0) return usage;

  const { data, error } = await db
    .from('sops')
    .select('slug, title, content_md')
    .or('content_md.ilike.%/api/admin/sop-images/%,content_md.ilike.%/api/admin/sop-videos/%');
  if (error) return { error: error.message };

  for (const sop of (data ?? []) as { slug: string; title: string; content_md: string }[]) {
    for (const id of sopMediaIdsIn(sop.content_md)) {
      usage[id]?.push({ slug: sop.slug, title: sop.title });
    }
  }
  return usage;
}

/** A row as the API returns it: no storage path, plus where it is used. */
export function toSopMedia(row: SopMediaRow, usedIn: SopMedia['used_in']): SopMedia {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    file_name: row.file_name,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    uploaded_by: row.uploaded_by,
    created_at: row.created_at,
    used_in: usedIn,
  };
}

/**
 * Remove uploads started more than a day ago and never confirmed: the row
 * and whatever part of the object made it to storage. Best-effort; a failure
 * is logged and retried on the next listing.
 */
export async function clearStaleUploads(db: Db): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_UPLOAD_MS).toISOString();
  const { data, error } = await db
    .from('sop_media')
    .select('id, storage_path')
    .eq('status', 'uploading')
    .lt('created_at', cutoff)
    .limit(50);
  if (error || !data || data.length === 0) return;

  const rows = data as { id: string; storage_path: string }[];
  const { error: removeError } = await db.storage
    .from(SOP_MEDIA_BUCKET)
    .remove(rows.map((row) => row.storage_path));
  if (removeError) console.error('[sop-media] stale object cleanup failed:', removeError.message);

  const { error: deleteError } = await db
    .from('sop_media')
    .delete()
    .in(
      'id',
      rows.map((row) => row.id)
    );
  if (deleteError) console.error('[sop-media] stale row cleanup failed:', deleteError.message);
}

/**
 * The file `id` names, of `kind` — a video id under the images route reads
 * as not found, so a reference always renders the way its path says.
 */
async function loadMedia(
  db: Db,
  kind: SopMediaKind,
  id: string | undefined
): Promise<SopMediaRow | Response> {
  if (!id || !isUuid(id)) return json({ error: 'id must be a UUID' }, 400);
  const { data, error } = await db
    .from('sop_media')
    .select('*')
    .eq('id', id)
    .eq('kind', kind)
    .maybeSingle();
  if (error) return dbError(error);
  const row = (data as SopMediaRow) ?? null;
  if (!row) return json({ error: `${kind === 'image' ? 'Image' : 'Video'} not found` }, 404);
  return row;
}

/**
 * The handlers behind one library file's route. This path is what documents
 * embed:
 *
 *   GET    → 302 to a short-lived signed link, so an <img>/<video> src can
 *            point straight here and always get a fresh one. ?format=json
 *            returns the link instead; ?download=1 downloads under the
 *            original name. Anyone with the /admin/sops page grant.
 *   PATCH  → { title } renames it. Admins only.
 *   DELETE → removes the object and the row. Admins only. Refused with 409
 *            while a document still embeds it, unless ?force=1 — the
 *            document would be left with a broken image or a dead player.
 */
export function sopMediaFileRoutes(kind: SopMediaKind): {
  GET: APIRoute;
  PATCH: APIRoute;
  DELETE: APIRoute;
} {
  const GET: APIRoute = async ({ cookies, params, url }) => {
    const gate = await requirePage(cookies, PAGE);
    if (gate instanceof Response) return gate;

    const db = getDb();
    if (!db) return json({ error: 'Storage unavailable' }, 503);

    const row = await loadMedia(db, kind, params.id);
    if (row instanceof Response) return row;
    // An unfinished upload has nothing to show behind it yet.
    if (row.status !== 'ready') return json({ error: 'Not found' }, 404);

    return signedAttachmentResponse(db, SOP_MEDIA_BUCKET, row, url);
  };

  const PATCH: APIRoute = async ({ cookies, params, request }) => {
    const gate = await gateMutation(cookies, request, requireAdmin);
    if (gate instanceof Response) return gate;

    const db = getDb();
    if (!db) return json({ error: 'Storage unavailable' }, 503);

    const body = await readJsonBody(request);
    if (body instanceof Response) return body;

    const row = await loadMedia(db, kind, params.id);
    if (row instanceof Response) return row;

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title || title.length > MAX_SOP_MEDIA_TITLE) {
      return json({ error: `title must be 1–${MAX_SOP_MEDIA_TITLE} characters` }, 400);
    }

    const { data, error } = await db
      .from('sop_media')
      .update({ title })
      .eq('id', row.id)
      .select('*')
      .single();
    if (error) return dbError(error);

    const usage = await mediaUsage(db, [row.id]);
    return json({
      media: toSopMedia(data as SopMediaRow, 'error' in usage ? [] : (usage[row.id] ?? [])),
    });
  };

  const DELETE: APIRoute = async ({ cookies, params, request, url }) => {
    const gate = await gateMutation(cookies, request, requireAdmin);
    if (gate instanceof Response) return gate;

    const db = getDb();
    if (!db) return json({ error: 'Storage unavailable' }, 503);

    const row = await loadMedia(db, kind, params.id);
    if (row instanceof Response) return row;

    if (url.searchParams.get('force') !== '1') {
      const usage = await mediaUsage(db, [row.id]);
      if ('error' in usage) return json({ error: usage.error }, 500);
      const usedIn = usage[row.id] ?? [];
      if (usedIn.length > 0) {
        return json(
          {
            error: `Still embedded in ${usedIn.map((sop) => sop.title).join(', ')}`,
            used_in: usedIn,
          },
          409
        );
      }
    }

    await removeStoredFile(db, SOP_MEDIA_BUCKET, row.storage_path, 'sop-media');

    const { error } = await db.from('sop_media').delete().eq('id', row.id);
    if (error) return dbError(error);

    return json({ ok: true });
  };

  return { GET, PATCH, DELETE };
}
