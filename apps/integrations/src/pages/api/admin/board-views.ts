// A board's saved views: its cards grouped by a column, an assignee, a date,
// or one of its fields (lib/boards/views.ts does the grouping, on the
// island). Views belong to the board and are shared, so anyone who can open
// the board can make, change, reorder, and remove them — the same gate as
// the board's cards, and the same 404 for a board this viewer cannot see.
// The board bundle (GET /api/admin/board-cards) carries the list.
//
//   POST   { board, name, groupBy, groupFieldKey?, dateUnit?, layout?, sortBy?,
//            hideFinished?, showEmpty? }                       → { view }
//   PATCH  { id, ...any of those }                            → { view }
//   PUT    { board, ids: [] }                                 → { ok }  (every view, in order)
//   DELETE ?id=<uuid>                                         → { ok }

import { BOARDS_HREF } from '@/components/admin/adminTools';
import { canViewBoard } from '@/lib/boards/access';
import { loadBoardFields } from '@/lib/boards/create-card';
import { loadBoardBySlug, loadViews } from '@/lib/boards/store';
import { BOARD_LIMITS, isBoardSlug } from '@/lib/boards/types';
import { parseViewInput } from '@/lib/boards/validate';
import { viewProblem } from '@/lib/boards/views';
import type { BoardRow, BoardViewRow } from '@/lib/db';
import {
  type APIRoute,
  beginDelete,
  beginMutation,
  type Db,
  dbError,
  isUuidParam,
  json,
  storeError,
} from '@/lib/http/route';

export const POST: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, email, body, gate } = ready;

  const slug = typeof body.board === 'string' ? body.board : '';
  if (!isBoardSlug(slug)) return json({ error: 'board must be a board slug' }, 400);
  if (!canViewBoard(gate.access, slug)) return json({ error: 'Board not found' }, 404);

  const parsed = parseViewInput(body, { create: true });
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  try {
    const board = await loadBoardBySlug(db, slug);
    if (!board) return json({ error: 'Board not found' }, 404);
    const existing = await loadViews(db, board.id);
    if (existing.length >= BOARD_LIMITS.viewsPerBoard) {
      return json({ error: `A board can have ${BOARD_LIMITS.viewsPerBoard} views at most` }, 400);
    }

    const row = {
      group_field_key: null,
      date_unit: null,
      layout: 'sections' as const,
      sort_by: 'manual',
      hide_finished: true,
      show_empty: false,
      ...parsed.value,
    };
    const problem = viewProblem(
      row as Pick<BoardViewRow, 'group_by' | 'group_field_key' | 'date_unit' | 'sort_by'>,
      await loadBoardFields(db, board.id)
    );
    if (problem) return json({ error: problem }, 400);

    const last = existing.at(-1)?.sort_order ?? 0;
    const { data, error } = await db
      .from('board_views')
      .insert({
        ...row,
        board_id: board.id,
        sort_order: last + 10,
        created_by: email,
        updated_by: email,
      })
      .select('*')
      .single();
    if (error) return dbError(error);
    return json({ view: data as BoardViewRow });
  } catch (e) {
    return storeError('board-views', e);
  }
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, email, body, gate } = ready;

  if (!isUuidParam(body.id)) return json({ error: 'id must be a UUID' }, 400);
  const parsed = parseViewInput(body, { create: false });
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  try {
    const found = await loadViewOnViewableBoard(db, body.id, gate.access);
    if (found instanceof Response) return found;
    const { view, board } = found;

    // Judged as the view will be after the save, not the patch alone, so
    // a new grouping is checked against the date unit already saved.
    const next = { ...view, ...parsed.value };
    const problem = viewProblem(next, await loadBoardFields(db, board.id));
    if (problem) return json({ error: problem }, 400);

    const { data, error } = await db
      .from('board_views')
      .update({ ...parsed.value, updated_by: email })
      .eq('id', view.id)
      .select('*')
      .single();
    if (error) return dbError(error);
    return json({ view: data as BoardViewRow });
  } catch (e) {
    return storeError('board-views', e);
  }
};

export const PUT: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, body, gate } = ready;

  const slug = typeof body.board === 'string' ? body.board : '';
  if (!isBoardSlug(slug)) return json({ error: 'board must be a board slug' }, 400);
  if (!canViewBoard(gate.access, slug)) return json({ error: 'Board not found' }, 404);
  const ids = body.ids;
  if (!Array.isArray(ids) || !ids.every(isUuidParam) || new Set(ids).size !== ids.length) {
    return json({ error: 'ids must be a list of unique view ids' }, 400);
  }

  try {
    const board = await loadBoardBySlug(db, slug);
    if (!board) return json({ error: 'Board not found' }, 404);
    const existing = new Set((await loadViews(db, board.id)).map((view) => view.id));
    if (ids.length !== existing.size || !ids.every((id) => existing.has(id))) {
      return json({ error: "ids must list every one of this board's views" }, 400);
    }
    // A reorder is not an edit: updated_by is left alone.
    for (const [index, id] of ids.entries()) {
      const { error } = await db
        .from('board_views')
        .update({ sort_order: (index + 1) * 10 })
        .eq('id', id);
      if (error) return dbError(error);
    }
    return json({ ok: true });
  } catch (e) {
    return storeError('board-views', e);
  }
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const ready = await beginDelete(cookies, request, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, email, gate } = ready;

  const id = url.searchParams.get('id');
  if (!isUuidParam(id)) return json({ error: 'id must be a UUID' }, 400);

  try {
    const found = await loadViewOnViewableBoard(db, id, gate.access);
    if (found instanceof Response) return found;
    const { error } = await db.from('board_views').delete().eq('id', found.view.id);
    if (error) return dbError(error);
    console.info(`[boards] ${email} deleted view "${found.view.name}" on ${found.board.slug}`);
    return json({ ok: true });
  } catch (e) {
    return storeError('board-views', e);
  }
};

/** The view and its board, or a 404 when either is missing or the board is not this viewer's. */
async function loadViewOnViewableBoard(
  db: Db,
  id: string,
  access: Parameters<typeof canViewBoard>[0]
): Promise<{ view: BoardViewRow; board: BoardRow } | Response> {
  const { data, error } = await db.from('board_views').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  const view = (data as BoardViewRow | null) ?? null;
  if (!view) return json({ error: 'View not found' }, 404);
  const { data: boardData, error: boardError } = await db
    .from('boards')
    .select('*')
    .eq('id', view.board_id)
    .maybeSingle();
  if (boardError) throw new Error(boardError.message);
  const board = (boardData as BoardRow | null) ?? null;
  if (!board || !canViewBoard(access, board.slug)) return json({ error: 'View not found' }, 404);
  return { view, board };
}
