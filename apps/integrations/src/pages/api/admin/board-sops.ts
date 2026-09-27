// The SOPs linked to a board, as board settings edits them. Linking is part
// of shaping the board, so both verbs take the whole /admin/boards grant
// (canManageBoards) — a single-board grantee sees the links on the board
// but cannot change them. What each viewer is shown is decided where the
// links are read (lib/boards/sops), not here.
//
//   GET ?board=<slug>           → { linked: LinkedSop[], options: SopOption[] }
//   PUT { board, sopIds: [] }   → { linked: LinkedSop[] }
//
// PUT replaces the board's links with exactly the ids sent, in that order.

import { BOARDS_HREF } from '@/components/admin/adminTools';
import { canManageBoards } from '@/lib/boards/access';
import {
  type LinkedSop,
  loadBoardSops,
  loadSopOptions,
  MAX_BOARD_SOPS,
  replaceBoardSops,
} from '@/lib/boards/sops';
import { loadBoardBySlug } from '@/lib/boards/store';
import { isBoardSlug } from '@/lib/boards/types';
import type { SopRow } from '@/lib/db';
import {
  type APIRoute,
  beginMutation,
  beginRead,
  isUuid,
  json,
  storeError,
} from '@/lib/http/route';

function trim(sops: SopRow[]): LinkedSop[] {
  return sops.map(({ id, slug, title }) => ({ id, slug, title }));
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const ready = await beginRead(cookies, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, gate } = ready;
  if (!canManageBoards(gate.access)) return json({ error: 'Forbidden' }, 403);

  const slug = url.searchParams.get('board');
  if (!slug || !isBoardSlug(slug)) return json({ error: 'board must be a board slug' }, 400);

  try {
    const board = await loadBoardBySlug(db, slug);
    if (!board) return json({ error: 'Board not found' }, 404);
    const [linked, options] = await Promise.all([loadBoardSops(db, board.id), loadSopOptions(db)]);
    return json({ linked: trim(linked), options });
  } catch (e) {
    return storeError('board-sops', e);
  }
};

export const PUT: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, email, body, gate } = ready;
  if (!canManageBoards(gate.access)) return json({ error: 'Forbidden' }, 403);

  const slug = typeof body.board === 'string' ? body.board : '';
  if (!isBoardSlug(slug)) return json({ error: 'board must be a board slug' }, 400);
  if (!Array.isArray(body.sopIds) || !body.sopIds.every(isUuid)) {
    return json({ error: 'sopIds must be a list of SOP ids' }, 400);
  }
  const sopIds = [...new Set(body.sopIds as string[])];
  if (sopIds.length > MAX_BOARD_SOPS) {
    return json({ error: `A board can link at most ${MAX_BOARD_SOPS} SOPs` }, 400);
  }

  try {
    const board = await loadBoardBySlug(db, slug);
    if (!board) return json({ error: 'Board not found' }, 404);
    if (sopIds.length > 0) {
      const { data, error } = await db.from('sops').select('id').in('id', sopIds);
      if (error) throw new Error(error.message);
      if ((data ?? []).length !== sopIds.length) {
        return json({ error: 'One of those SOPs does not exist' }, 400);
      }
    }
    await replaceBoardSops(db, board.id, sopIds, email);
    return json({ linked: trim(await loadBoardSops(db, board.id)) });
  } catch (e) {
    return storeError('board-sops', e);
  }
};
