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
import { normalizeEmail } from '@/lib/email/address';
import { dbError, isUuid, json } from '@/lib/http/route';
import { logLostFoundEvent } from '@/lib/lost-found/log';
import {
  LOST_FOUND_BUCKET as BUCKET,
  buildItemStoragePath,
  MAX_ATTACHMENTS_PER_ITEM,
} from '@/lib/lost-found/media';
import { CLOSED_STATUSES } from '@/lib/lost-found/types';
import { FIELD_LIMITS } from '@/lib/lost-found/validate';
import {
  checkUpload,
  readUpload,
  removeStoredFile,
  signedAttachmentResponse,
  storeUpload,
} from '@/lib/media/route';

const PAGE = '/admin/lost-found';

const emailOf = (gate: { user: { email: string } }): string => normalizeEmail(gate.user.email);

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const form = await readUpload(request);
  if (form instanceof Response) return form;

  const itemId = String(form.get('itemId') ?? '');
  if (!isUuid(itemId)) return json({ error: 'itemId must be a UUID' }, 400);

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

  const kind = checkUpload(file);
  if (kind instanceof Response) return kind;

  const { count, error: countError } = await db
    .from('lost_found_attachments')
    .select('id', { count: 'exact', head: true })
    .eq('item_id', itemId);
  if (countError) return dbError(countError);
  if ((count ?? 0) >= MAX_ATTACHMENTS_PER_ITEM) {
    return json({ error: `An item can hold ${MAX_ATTACHMENTS_PER_ITEM} photos at most` }, 409);
  }

  const email = emailOf(gate);
  const fileName = (file.name || `${kind}.bin`).slice(0, FIELD_LIMITS.title);
  const storagePath = buildItemStoragePath(itemId, fileName, file.type);

  const attachment = await storeUpload<LostFoundAttachmentRow>(
    db,
    { bucket: BUCKET, path: storagePath, file, scope: 'lost-found' },
    () =>
      db
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
        .single()
  );
  if (attachment instanceof Response) return attachment;
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
  if (!id || !isUuid(id)) return json({ error: 'id must be a UUID' }, 400);

  const { data, error } = await db
    .from('lost_found_attachments')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return dbError(error);

  const row = (data as LostFoundAttachmentRow) ?? null;
  if (!row) return json({ error: 'Photo not found' }, 404);

  return signedAttachmentResponse(db, BUCKET, row, url);
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id || !isUuid(id)) return json({ error: 'id must be a UUID' }, 400);

  const { data, error } = await db
    .from('lost_found_attachments')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return dbError(error);

  const attachment = (data as LostFoundAttachmentRow) ?? null;
  if (!attachment) return json({ error: 'Photo not found' }, 404);

  await removeStoredFile(db, BUCKET, attachment.storage_path, 'lost-found');

  const { error: deleteError } = await db.from('lost_found_attachments').delete().eq('id', id);
  if (deleteError) return dbError(deleteError);

  await logLostFoundEvent(db, {
    itemId: attachment.item_id,
    action: 'attachment_removed',
    actor: emailOf(gate),
    detail: { file_name: attachment.file_name, kind: attachment.kind },
  });

  return json({ ok: true });
};
