// The image behind a board's form. Managers only, like the form itself.
//
//   POST   multipart { slug, file }  → { background: { path, url } }
//   DELETE ?slug=<slug>              → { background: null }
//
// One image per form: a new upload replaces the old object, and removing
// it clears the column. A board with no form row yet gets one, built from
// the default form, so a background chosen before anything else is saved
// does not leave a half-made row behind it.

import { BOARDS_HREF } from '@/components/admin/adminTools';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import { canManageBoards } from '@/lib/boards/access';
import {
  backgroundOf,
  backgroundStoragePath,
  FORM_MEDIA_BUCKET,
  removeBackgroundObject,
} from '@/lib/boards/form-media';
import { checkBackgroundFile, defaultFormConfig } from '@/lib/boards/forms';
import { type APIRoute, beginDelete, json, storeError } from '@/lib/boards/route';
import { loadBoardBySlug, loadFields, loadForm } from '@/lib/boards/store';
import { isBoardSlug } from '@/lib/boards/types';
import { getDb } from '@/lib/db';

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, BOARDS_HREF);
  if (gate instanceof Response) return gate;
  if (!canManageBoards(gate.access)) return json({ error: 'Forbidden' }, 403);

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

  const slug = String(form.get('slug') ?? '');
  if (!isBoardSlug(slug)) return json({ error: 'slug is not a board slug' }, 400);
  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'No file was uploaded' }, 400);
  const problem = checkBackgroundFile(file);
  if (problem) return json({ error: problem }, 415);

  const email = (gate.user.email ?? '').trim().toLowerCase();

  try {
    const board = await loadBoardBySlug(db, slug);
    if (!board) return json({ error: 'Board not found' }, 404);
    const row = await loadForm(db, board.id);

    const path = backgroundStoragePath(board.id, file.name || 'background', file.type);
    const { error: uploadError } = await db.storage
      .from(FORM_MEDIA_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) {
      console.error('[board-forms] upload failed:', uploadError.message);
      return json({ error: `Upload failed: ${uploadError.message}` }, 502);
    }

    const write = row
      ? db.from('board_forms').update({ background_path: path, updated_by: email }).eq('id', row.id)
      : db.from('board_forms').insert({
          board_id: board.id,
          ...rowOf(defaultFormConfig(await loadFields(db, board.id), board.name)),
          background_path: path,
          created_by: email,
          updated_by: email,
        });
    const { error } = await write;
    if (error) {
      await removeBackgroundObject(db, path);
      return json({ error: error.message }, 500);
    }
    if (row?.background_path) await removeBackgroundObject(db, row.background_path);

    return json({ background: backgroundOf(db, path) });
  } catch (e) {
    return storeError('board-form-media', e);
  }
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const ready = await beginDelete(cookies, request, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, email, gate } = ready;
  if (!canManageBoards(gate.access)) return json({ error: 'Forbidden' }, 403);

  const slug = url.searchParams.get('slug');
  if (!slug || !isBoardSlug(slug)) return json({ error: 'slug is not a board slug' }, 400);

  try {
    const board = await loadBoardBySlug(db, slug);
    if (!board) return json({ error: 'Board not found' }, 404);
    const row = await loadForm(db, board.id);
    if (!row?.background_path) return json({ background: null });

    const { error } = await db
      .from('board_forms')
      .update({ background_path: null, updated_by: email })
      .eq('id', row.id);
    if (error) return json({ error: error.message }, 500);
    await removeBackgroundObject(db, row.background_path);

    return json({ background: null });
  } catch (e) {
    return storeError('board-form-media', e);
  }
};

/** A default form as columns, for a row that has to exist before its image can. */
function rowOf(config: ReturnType<typeof defaultFormConfig>) {
  return {
    enabled: config.enabled,
    title: config.title,
    access: config.access,
    layout: config.layout,
    title_mode: config.titleMode,
    title_template: config.titleTemplate,
    intro: config.intro,
    confirmation: config.confirmation,
    submit_label: config.submitLabel,
    questions: config.questions,
  };
}
