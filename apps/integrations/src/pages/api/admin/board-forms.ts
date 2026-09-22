// A board's form, for the builder. Managers only, like board settings: a
// form decides what a stranger can write onto a board, which is a manager's
// call even on a board a single grantee works.
//
// The form is one row per board that may not exist yet, so a save is an
// upsert rather than a reconcile, and the builder's read is its own — the
// board's fields plus the form — rather than the card bundle. That is why
// this is its own route and not another key on /api/admin/boards.
//
//   GET   ?slug=<slug>            → { board, form, exists, fields }
//   PATCH { slug, ...FormPatch }  → { board, form, exists: true, fields }
//
// A PATCH is merged onto the saved form (or the default, for a board with
// none), then the whole is checked: finalizeForm for the rules that span
// settings, formFieldError for pointers at fields the board does not have.

import { BOARDS_HREF } from '@/components/admin/adminTools';
import { canManageBoards } from '@/lib/boards/access';
import { backgroundOf } from '@/lib/boards/form-media';
import {
  defaultFormConfig,
  type FormBackground,
  type FormConfig,
  finalizeForm,
  formConfigOf,
  formFieldError,
  parseFormPatch,
} from '@/lib/boards/forms';
import {
  type APIRoute,
  beginMutation,
  beginRead,
  type Db,
  json,
  storeError,
} from '@/lib/boards/route';
import { loadBoardBySlug, loadFields, loadForm } from '@/lib/boards/store';
import { isBoardSlug } from '@/lib/boards/types';
import type { BoardFieldRow, BoardFormRow, BoardRow } from '@/lib/db';

interface FormResponse {
  board: Pick<BoardRow, 'slug' | 'name' | 'card_noun' | 'archived'>;
  form: FormConfig;
  /** Whether a row exists yet, or the builder is looking at the default. */
  exists: boolean;
  /** The image behind the form, with its public URL; null for none. */
  background: FormBackground | null;
  fields: BoardFieldRow[];
}

function respond(
  db: Db,
  board: BoardRow,
  row: BoardFormRow | null,
  fields: BoardFieldRow[]
): FormResponse {
  return {
    board: {
      slug: board.slug,
      name: board.name,
      card_noun: board.card_noun,
      archived: board.archived,
    },
    form: row ? formConfigOf(row) : defaultFormConfig(fields, board.name),
    exists: row !== null,
    background: backgroundOf(db, row?.background_path ?? null),
    fields,
  };
}

async function loadAll(db: Db, slug: string) {
  const board = await loadBoardBySlug(db, slug);
  if (!board) return null;
  const [row, fields] = await Promise.all([loadForm(db, board.id), loadFields(db, board.id)]);
  return { board, row, fields };
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const ready = await beginRead(cookies, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  if (!canManageBoards(ready.gate.access)) return json({ error: 'Forbidden' }, 403);

  const slug = url.searchParams.get('slug');
  if (!slug || !isBoardSlug(slug)) return json({ error: 'slug is not a board slug' }, 400);

  try {
    const loaded = await loadAll(ready.db, slug);
    if (!loaded) return json({ error: 'Board not found' }, 404);
    return json(respond(ready.db, loaded.board, loaded.row, loaded.fields));
  } catch (e) {
    return storeError('board-forms', e);
  }
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, email, body, gate } = ready;
  if (!canManageBoards(gate.access)) return json({ error: 'Forbidden' }, 403);

  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!isBoardSlug(slug)) return json({ error: 'slug is not a board slug' }, 400);

  const parsed = parseFormPatch(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  try {
    const loaded = await loadAll(db, slug);
    if (!loaded) return json({ error: 'Board not found' }, 404);
    const { board, row, fields } = loaded;

    const merged = finalizeForm({
      ...(row ? formConfigOf(row) : defaultFormConfig(fields, board.name)),
      ...parsed.value,
    });
    if (!merged.ok) return json({ error: merged.error }, 400);
    const stale = formFieldError(merged.value, fields);
    if (stale) return json({ error: stale }, 400);

    const config = merged.value;
    const { data, error } = await db
      .from('board_forms')
      .upsert(
        {
          board_id: board.id,
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
          updated_by: email,
          ...(row ? {} : { created_by: email }),
        },
        { onConflict: 'board_id' }
      )
      .select('*')
      .single();
    if (error) return json({ error: error.message }, 500);

    return json(respond(db, board, data as BoardFormRow, fields));
  } catch (e) {
    return storeError('board-forms', e);
  }
};
