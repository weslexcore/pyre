// One SOP video (see lib/sops/videos). This path is what documents embed:
//
//   GET    → 302 to a short-lived signed link, so a <video src> can point
//            straight here and always get a fresh one. ?format=json returns
//            the link instead; ?download=1 downloads under the original name.
//            Anyone with the /admin/sops page grant.
//   PATCH  → { title } renames it. Admins only.
//   DELETE → removes the object and the row. Admins only. Refused with 409
//            while a document still embeds it, unless ?force=1 — the
//            documents would be left with a dead player.

import type { APIRoute } from 'astro';
import { requireAdmin, requirePage } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import { dbError, gateMutation, isUuid, json, readJsonBody } from '@/lib/http/route';
import { removeStoredFile, signedAttachmentResponse } from '@/lib/media/route';
import { MAX_SOP_VIDEO_TITLE, SOP_VIDEO_BUCKET } from '@/lib/sops/videos';
import { type SopVideoRow, toSopVideo, videoUsage } from '@/lib/sops/videos-server';

const PAGE = '/admin/sops';

async function loadVideo(
  db: NonNullable<ReturnType<typeof getDb>>,
  id: string | undefined
): Promise<SopVideoRow | Response> {
  if (!id || !isUuid(id)) return json({ error: 'id must be a UUID' }, 400);
  const { data, error } = await db.from('sop_videos').select('*').eq('id', id).maybeSingle();
  if (error) return dbError(error);
  const row = (data as SopVideoRow) ?? null;
  if (!row) return json({ error: 'Video not found' }, 404);
  return row;
}

export const GET: APIRoute = async ({ cookies, params, url }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const row = await loadVideo(db, params.id);
  if (row instanceof Response) return row;
  // An unfinished upload has nothing playable behind it yet.
  if (row.status !== 'ready') return json({ error: 'Video not found' }, 404);

  return signedAttachmentResponse(db, SOP_VIDEO_BUCKET, row, url);
};

export const PATCH: APIRoute = async ({ cookies, params, request }) => {
  const gate = await gateMutation(cookies, request, requireAdmin);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const row = await loadVideo(db, params.id);
  if (row instanceof Response) return row;

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > MAX_SOP_VIDEO_TITLE) {
    return json({ error: `title must be 1–${MAX_SOP_VIDEO_TITLE} characters` }, 400);
  }

  const { data, error } = await db
    .from('sop_videos')
    .update({ title })
    .eq('id', row.id)
    .select('*')
    .single();
  if (error) return dbError(error);

  const usage = await videoUsage(db, [row.id]);
  return json({
    video: toSopVideo(data as SopVideoRow, 'error' in usage ? [] : (usage[row.id] ?? [])),
  });
};

export const DELETE: APIRoute = async ({ cookies, params, request, url }) => {
  const gate = await gateMutation(cookies, request, requireAdmin);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const row = await loadVideo(db, params.id);
  if (row instanceof Response) return row;

  if (url.searchParams.get('force') !== '1') {
    const usage = await videoUsage(db, [row.id]);
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

  await removeStoredFile(db, SOP_VIDEO_BUCKET, row.storage_path, 'sop-videos');

  const { error } = await db.from('sop_videos').delete().eq('id', row.id);
  if (error) return dbError(error);

  return json({ ok: true });
};
