// Server half of SOP videos (see lib/sops/videos and the sop_videos
// migration): loading the library with where each video is used, and
// clearing uploads that were started and never finished. Server-only.

import type { Db } from '@/lib/http/route';
import { SOP_VIDEO_BUCKET, type SopVideo, sopVideoIdsIn } from './videos';

export interface SopVideoRow {
  id: string;
  title: string;
  storage_path: string;
  file_name: string;
  mime_type: SopVideo['mime_type'];
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
 * Every non-archived SOP that references `ids`, keyed by video id. Read
 * from the current text of each document, so it is what a reader sees today.
 */
export async function videoUsage(
  db: Db,
  ids: string[]
): Promise<Record<string, { slug: string; title: string }[]> | { error: string }> {
  const usage: Record<string, { slug: string; title: string }[]> = {};
  for (const id of ids) usage[id] = [];
  if (ids.length === 0) return usage;

  const { data, error } = await db
    .from('sops')
    .select('slug, title, content_md')
    .ilike('content_md', '%/api/admin/sop-videos/%');
  if (error) return { error: error.message };

  for (const sop of (data ?? []) as { slug: string; title: string; content_md: string }[]) {
    for (const id of sopVideoIdsIn(sop.content_md)) {
      usage[id]?.push({ slug: sop.slug, title: sop.title });
    }
  }
  return usage;
}

/** A row as the API returns it: no storage path, plus where it is used. */
export function toSopVideo(row: SopVideoRow, usedIn: SopVideo['used_in']): SopVideo {
  return {
    id: row.id,
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
    .from('sop_videos')
    .select('id, storage_path')
    .eq('status', 'uploading')
    .lt('created_at', cutoff)
    .limit(50);
  if (error || !data || data.length === 0) return;

  const rows = data as { id: string; storage_path: string }[];
  const { error: removeError } = await db.storage
    .from(SOP_VIDEO_BUCKET)
    .remove(rows.map((row) => row.storage_path));
  if (removeError) console.error('[sop-videos] stale object cleanup failed:', removeError.message);

  const { error: deleteError } = await db
    .from('sop_videos')
    .delete()
    .in(
      'id',
      rows.map((row) => row.id)
    );
  if (deleteError) console.error('[sop-videos] stale row cleanup failed:', deleteError.message);
}
