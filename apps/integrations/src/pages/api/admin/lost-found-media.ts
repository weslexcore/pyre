// Photos of lost-and-found items.
//
// POST takes one file as multipart/form-data, puts it in the private
// lost-found-media bucket, and records a lost_found_attachments row. GET
// exchanges an attachment id for a short-lived signed URL — by default as a
// redirect, so an <img> src can point straight at this route and always get a
// fresh link. DELETE removes the object and its row.
//
// The bucket is private even though a lost bottle is not sensitive: the photo
// is taken inside the building, often with other people's things in frame, and
// a public bucket is a URL that outlives the item. Uploads go through the
// function rather than a direct-to-storage signed URL so size, MIME type, and
// the per-item count are all enforced server-side, and the row and the object
// are created together.

import type { APIRoute } from 'astro';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import type { LostFoundAttachmentRow, LostFoundItemRow } from '@/lib/db';
import { getDb } from '@/lib/db';
import { logLostFoundEvent } from '@/lib/lost-found/log';
import {
  buildItemStoragePath,
  formatBytes,
  kindForMime,
  LOST_FOUND_BUCKET as BUCKET,
  MAX_ATTACHMENTS_PER_ITEM,
  MAX_FILE_BYTES,
} from '@/lib/lost-found/media';
import { CLOSED_STATUSES } from '@/lib/lost-found/types';
import { FIELD_LIMITS } from '@/lib/lost-found/validate';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const PAGE = '/admin/lost-found';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Long enough to load a page of photos, short enough that a leaked link dies. */
const SIGNED_URL_TTL_SECONDS = 600;

const emailOf = (gate: { user: { email: string } }): string =>
  (gate.user.email ?? '').trim().toLowerCase();

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, PAGE);
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

  const itemId = String(form.get('itemId') ?? '');
  if (!UUID_RE.test(itemId)) return json({ error: 'itemId must be a UUID' }, 400);

  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'No file was uploaded' }, 400);

  const { data: itemData } = await db
    .from('lost_found_items')
    .select('*')
    .eq('id', itemId)
    .maybeSingle();
  const item = (itemData as LostFoundItemRow) ?? null;
  if (!item) return json({ error: 'Item not found' }, 404);
  if ((CLOSED_STATUSES as readonly string[]).includes(item.status)) {
    return json({ error: 'That item has already left our hands' }, 409);
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
    .from('lost_found_attachments')
    .select('id', { count: 'exact', head: true })
    .eq('item_id', itemId);
  if (countError) return json({ error: countError.message }, 500);
  if ((count ?? 0) >= MAX_ATTACHMENTS_PER_ITEM) {
    return json({ error: `An item can hold ${MAX_ATTACHMENTS_PER_ITEM} photos at most` }, 409);
  }

  const email = emailOf(gate);
  const fileName = (file.name || `${kind}.bin`).slice(0, FIELD_LIMITS.title);
  const storagePath = buildItemStoragePath(itemId, fileName, file.type);

  const { error: uploadError } = await db.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    console.error('[lost-found] upload failed:', uploadError.message);
    return json({ error: `Upload failed: ${uploadError.message}` }, 502);
  }

  const { data, error } = await db
    .from('lost_found_attachments')
    .insert({
      item_id: itemId,
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

  const attachment = data as LostFoundAttachmentRow;
  await logLostFoundEvent(db, {
    itemId,
    action: 'attachment_added',
    actor: email,
    detail: { file_name: fileName, kind, size_bytes: file.size },
  });

  return json({ attachment }, 201);
};

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id || !UUID_RE.test(id)) return json({ error: 'id must be a UUID' }, 400);

  const { data, error } = await db
    .from('lost_found_attachments')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);

  const row = (data as LostFoundAttachmentRow) ?? null;
  if (!row) return json({ error: 'Photo not found' }, 404);

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

  return new Response(null, {
    status: 302,
    headers: { Location: signed.signedUrl, 'Cache-Control': 'private, no-store' },
  });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id || !UUID_RE.test(id)) return json({ error: 'id must be a UUID' }, 400);

  const { data, error } = await db
    .from('lost_found_attachments')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);

  const attachment = (data as LostFoundAttachmentRow) ?? null;
  if (!attachment) return json({ error: 'Photo not found' }, 404);

  const { error: storageError } = await db.storage.from(BUCKET).remove([attachment.storage_path]);
  if (storageError) {
    console.error('[lost-found] media delete failed:', storageError.message);
  }

  const { error: deleteError } = await db.from('lost_found_attachments').delete().eq('id', id);
  if (deleteError) return json({ error: deleteError.message }, 500);

  await logLostFoundEvent(db, {
    itemId: attachment.item_id,
    action: 'attachment_removed',
    actor: emailOf(gate),
    detail: { file_name: attachment.file_name, kind: attachment.kind },
  });

  return json({ ok: true });
};
