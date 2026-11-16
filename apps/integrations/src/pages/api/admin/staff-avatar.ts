// Staff avatars: the photo anyone on the dashboard sees beside a person's
// name, and the colour of their initials badge when they have no photo.
// Everyone may see everyone's. Each person changes only their own, from
// /admin/account.
//
//   GET    ?id=<staff uuid>&v=<version>   → the photo's bytes (cached for good;
//                                          a new upload is a new `v`)
//   POST   multipart { file }             → { src }   set your photo
//   PATCH  { color }                      → { color } set your badge colour
//   DELETE                                → { ok }    back to the initials badge
//
// The bucket is private. GET streams the object through this route rather
// than redirecting to a signed URL, so the browser can cache one stable URL
// per photo instead of refetching a fresh signature on every page.

import { invalidateAccessCache } from '@/lib/auth/access';
import { requireStaff } from '@/lib/auth/admin';
import { getDb, type StaffRow } from '@/lib/db';
import {
  type APIRoute,
  beginDelete,
  beginMutation,
  beginRead,
  type Db,
  gateMutation,
  isUuidParam,
  json,
  sessionEmail,
  storeError,
} from '@/lib/http/route';
import { readUpload } from '@/lib/media/route';
import {
  AVATAR_COLORS,
  AVATAR_MAX_BYTES,
  type AVATAR_MIME_TYPES,
  avatarSrc,
  isAvatarColor,
} from '@/lib/staff/avatar';

const BUCKET = 'staff-avatars';
const SCOPE = 'staff-avatar';

const EXTENSIONS: Record<(typeof AVATAR_MIME_TYPES)[number], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const GET: APIRoute = async ({ cookies, url }) => {
  const ready = await beginRead(cookies, requireStaff);
  if (ready instanceof Response) return ready;
  const { db } = ready;

  const id = url.searchParams.get('id');
  if (!isUuidParam(id)) return json({ error: 'id must be a UUID' }, 400);

  try {
    // Read fresh: a roster cache on another instance may still name a photo
    // that was just replaced (and deleted). The browser caches the bytes, so
    // this runs about once per photo per viewer.
    const { data: row, error: rowError } = await db
      .from('staff')
      .select('id, avatar_path')
      .eq('id', id)
      .maybeSingle();
    if (rowError) throw new Error(rowError.message);
    const src = row ? avatarSrc(row as Pick<StaffRow, 'id' | 'avatar_path'>) : null;
    if (!row?.avatar_path || !src) return json({ error: 'No photo' }, 404);

    const { data, error } = await db.storage.from(BUCKET).download(row.avatar_path);
    if (error || !data) return json({ error: 'No photo' }, 404);

    // A stale `v` (a page rendered before a newer upload) still gets the
    // current photo, just not cached for good.
    const current = new URL(src, url).searchParams.get('v') === url.searchParams.get('v');
    return new Response(data, {
      headers: {
        'Content-Type': data.type || 'image/jpeg',
        'Cache-Control': current ? 'private, max-age=31536000, immutable' : 'private, no-cache',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    return storeError(SCOPE, e);
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await gateMutation(cookies, request, requireStaff);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const form = await readUpload(request);
  if (form instanceof Response) return form;
  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'No file was uploaded' }, 400);
  const extension = EXTENSIONS[file.type as keyof typeof EXTENSIONS];
  if (!extension) return json({ error: 'The photo must be a JPEG, PNG or WebP image' }, 415);
  if (file.size === 0) return json({ error: 'That file is empty' }, 400);
  if (file.size > AVATAR_MAX_BYTES) return json({ error: 'That photo is over 2 MB' }, 413);

  try {
    const me = await ownRow(db, sessionEmail(gate));
    if (!me) return json({ error: 'You are not on the staff roster' }, 404);

    const path = `${me.id}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await db.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) {
      console.error(`[${SCOPE}] upload failed:`, uploadError.message);
      return json({ error: `Upload failed: ${uploadError.message}` }, 502);
    }

    const { error } = await db.from('staff').update({ avatar_path: path }).eq('id', me.id);
    if (error) {
      await db.storage.from(BUCKET).remove([path]);
      return json({ error: error.message }, 500);
    }
    await removeOld(db, me.avatar_path);
    invalidateAccessCache();
    return json({ src: avatarSrc({ id: me.id, avatar_path: path }) }, 201);
  } catch (e) {
    return storeError(SCOPE, e);
  }
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, requireStaff);
  if (ready instanceof Response) return ready;
  const { db, email, body } = ready;

  if (!isAvatarColor(body.color)) {
    return json({ error: `color must be one of ${Object.keys(AVATAR_COLORS).join(', ')}` }, 400);
  }

  try {
    const me = await ownRow(db, email);
    if (!me) return json({ error: 'You are not on the staff roster' }, 404);
    const { error } = await db.from('staff').update({ avatar_color: body.color }).eq('id', me.id);
    if (error) return json({ error: error.message }, 500);
    invalidateAccessCache();
    return json({ color: AVATAR_COLORS[body.color] });
  } catch (e) {
    return storeError(SCOPE, e);
  }
};

export const DELETE: APIRoute = async ({ cookies, request }) => {
  const ready = await beginDelete(cookies, request, requireStaff);
  if (ready instanceof Response) return ready;
  const { db, email } = ready;

  try {
    const me = await ownRow(db, email);
    if (!me) return json({ error: 'You are not on the staff roster' }, 404);
    if (me.avatar_path) {
      const { error } = await db.from('staff').update({ avatar_path: null }).eq('id', me.id);
      if (error) return json({ error: error.message }, 500);
      await removeOld(db, me.avatar_path);
      invalidateAccessCache();
    }
    return json({ ok: true });
  } catch (e) {
    return storeError(SCOPE, e);
  }
};

/** The caller's own staff row, read fresh (not from the roster cache). */
async function ownRow(db: Db, email: string): Promise<StaffRow | null> {
  if (!email) return null;
  const { data, error } = await db.from('staff').select('*').eq('email', email).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as StaffRow) ?? null;
}

/** The replaced photo's object; a failure leaves an orphan, never an error. */
async function removeOld(db: Db, path: string | null): Promise<void> {
  if (!path) return;
  const { error } = await db.storage.from(BUCKET).remove([path]);
  if (error) console.error(`[${SCOPE}] old photo delete failed:`, error.message);
}
