// Upload a photo for an email: a custom background or an image block, on a
// journey or a newsletter. Anyone who can edit either may upload.
//
//   POST multipart { file } -> { url }
//
// The answer is the image's permanent public address, which the editor
// writes into the email's content. Uploads are never deleted (see
// lib/email/media.ts).

import { assertSameOrigin, requireAnyPage } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import { EMAIL_MEDIA_BUCKET, emailMediaPath, emailMediaProblem } from '@/lib/email/media';
import { type APIRoute, json } from '@/lib/http/route';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requireAnyPage(cookies, ['/admin/journeys', '/admin/newsletters']);
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
  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'No file was uploaded' }, 400);
  const problem = emailMediaProblem(file);
  if (problem) return json({ error: problem }, 415);

  const path = emailMediaPath(file.type);
  const { error } = await db.storage
    .from(EMAIL_MEDIA_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' });
  if (error) {
    console.error('[email-media] upload failed:', error.message);
    return json({ error: `Upload failed: ${error.message}` }, 502);
  }
  const { data } = db.storage.from(EMAIL_MEDIA_BUCKET).getPublicUrl(path);
  return json({ url: data.publicUrl }, 201);
};
