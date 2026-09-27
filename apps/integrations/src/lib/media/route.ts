// The storage mechanics every attachment route (shift notes, incidents,
// lost-and-found) shares: reading one multipart upload, checking the file,
// storing object + row together, and serving a short-lived signed link. Who
// may attach to what, and which row the file belongs to, stay in each route.
// Server-only.

import type { SupabaseClient } from '@supabase/supabase-js';
import { json } from '@/lib/http/json';
import { type AttachmentKind, formatBytes, kindForMime, MAX_FILE_BYTES } from './attachments';

/** Long enough to load a page of media, short enough that a leaked link dies. */
export const SIGNED_URL_TTL_SECONDS = 600;

/** The upload's form fields: 415 unless multipart, 400 if it won't parse. */
export async function readUpload(request: Request): Promise<FormData | Response> {
  if (!request.headers.get('content-type')?.includes('multipart/form-data')) {
    return json({ error: 'Content-Type must be multipart/form-data' }, 415);
  }
  try {
    return await request.formData();
  } catch {
    return json({ error: 'Could not read the upload' }, 400);
  }
}

/** The file's kind, or the 400/413/415 that rejects it. */
export function checkUpload(file: File): AttachmentKind | Response {
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
  return kind;
}

/**
 * Put the object in the bucket, then write its row with `insertRow`; if the
 * row fails, the object is removed so no orphan is left behind. Returns the
 * row, or the error Response.
 */
export async function storeUpload<Row>(
  db: SupabaseClient,
  opts: { bucket: string; path: string; file: File; scope: string },
  insertRow: () => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<Row | Response> {
  const { error: uploadError } = await db.storage
    .from(opts.bucket)
    .upload(opts.path, opts.file, { contentType: opts.file.type, upsert: false });
  if (uploadError) {
    console.error(`[${opts.scope}] upload failed:`, uploadError.message);
    return json({ error: `Upload failed: ${uploadError.message}` }, 502);
  }

  const { data, error } = await insertRow();
  if (error) {
    await db.storage.from(opts.bucket).remove([opts.path]);
    return json({ error: error.message }, 500);
  }
  return data as Row;
}

/**
 * A signed link to a stored attachment: as JSON with `?format=json`,
 * otherwise a 302 so an <img>/<video> src can point straight at the route.
 * `?download=1` makes the link download under the original file name.
 */
export async function signedAttachmentResponse(
  db: SupabaseClient,
  bucket: string,
  row: { storage_path: string; file_name: string },
  url: URL
): Promise<Response> {
  const { data: signed, error } = await db.storage
    .from(bucket)
    .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS, {
      download: url.searchParams.get('download') === '1' ? row.file_name : undefined,
    });
  if (error || !signed?.signedUrl) {
    return json({ error: error?.message ?? 'Could not sign that file' }, 502);
  }

  if (url.searchParams.get('format') === 'json') {
    return json({ url: signed.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS, attachment: row });
  }

  return new Response(null, {
    status: 302,
    headers: { Location: signed.signedUrl, 'Cache-Control': 'private, no-store' },
  });
}

/** Remove a stored object; a failure is logged, never fatal (the row goes regardless). */
export async function removeStoredFile(
  db: SupabaseClient,
  bucket: string,
  path: string,
  scope: string
): Promise<void> {
  const { error } = await db.storage.from(bucket).remove([path]);
  if (error) console.error(`[${scope}] media delete failed:`, error.message);
}
