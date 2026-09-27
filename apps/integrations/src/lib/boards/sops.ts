// The SOPs linked to a board, and the boards linked to an SOP (board_sops).
// Server-only.
//
// The link is many-to-many and only a pointer: each side still answers
// who may follow it. A board lists only the SOPs its viewer may read (the
// SOP library grant, then the document's own grants), and an SOP lists only
// the boards its reader may open (lib/boards/access). Archived documents
// and boards drop out of both lists, so a link to something put away stops
// showing without anyone having to unlink it.

import type { SupabaseClient } from '@supabase/supabase-js';
import { canViewPage, type PageAccess } from '@/components/admin/adminTools';
import type { BoardRow, BoardSopRow, SopRow } from '@/lib/db';
import { canViewSop, type SopViewer } from '@/lib/sops/levels';
import { canViewBoard } from './access';

const SOPS_HREF = '/admin/sops';

/** More than any board should carry; bounds the picker's save. */
export const MAX_BOARD_SOPS = 30;

/** An SOP as a board shows it. */
export interface LinkedSop {
  id: string;
  slug: string;
  title: string;
}

/** A board as an SOP shows it. */
export interface LinkedBoard {
  slug: string;
  name: string;
}

/** An SOP the settings picker can offer. */
export interface SopOption extends LinkedSop {
  category: string;
}

/** The board's linked SOPs in the board's order, whoever is asking. */
export async function loadBoardSops(db: SupabaseClient, boardId: string): Promise<SopRow[]> {
  const { data, error } = await db
    .from('board_sops')
    .select('sop_id, sort_order')
    .eq('board_id', boardId)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  const links = (data ?? []) as Pick<BoardSopRow, 'sop_id' | 'sort_order'>[];
  if (links.length === 0) return [];

  const sops = await db
    .from('sops')
    .select('*')
    .in(
      'id',
      links.map((link) => link.sop_id)
    );
  if (sops.error) throw new Error(sops.error.message);
  const byId = new Map(((sops.data ?? []) as SopRow[]).map((sop) => [sop.id, sop]));
  return links.flatMap((link) => byId.get(link.sop_id) ?? []);
}

/** Of a board's SOPs, the ones this viewer may open, trimmed for the page. */
export function sopsForViewer(sops: SopRow[], access: PageAccess, viewer: SopViewer): LinkedSop[] {
  if (!canViewPage(access, SOPS_HREF)) return [];
  return sops
    .filter((sop) => !sop.archived && canViewSop(viewer, sop))
    .map(({ id, slug, title }) => ({ id, slug, title }));
}

/** The boards an SOP is linked to that this reader may open, by name. */
export async function loadSopBoards(
  db: SupabaseClient,
  sopId: string,
  access: PageAccess
): Promise<LinkedBoard[]> {
  const { data, error } = await db.from('board_sops').select('board_id').eq('sop_id', sopId);
  if (error) throw new Error(error.message);
  const ids = ((data ?? []) as Pick<BoardSopRow, 'board_id'>[]).map((row) => row.board_id);
  if (ids.length === 0) return [];

  const boards = await db
    .from('boards')
    .select('slug, name, archived')
    .in('id', ids)
    .order('name', { ascending: true });
  if (boards.error) throw new Error(boards.error.message);
  return ((boards.data ?? []) as Pick<BoardRow, 'slug' | 'name' | 'archived'>[])
    .filter((board) => !board.archived && canViewBoard(access, board.slug))
    .map(({ slug, name }) => ({ slug, name }));
}

/** Every SOP a board could link to: the live library, in section then title order. */
export async function loadSopOptions(db: SupabaseClient): Promise<SopOption[]> {
  const { data, error } = await db
    .from('sops')
    .select('id, slug, title, category')
    .eq('archived', false)
    .order('category', { ascending: true })
    .order('title', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as SopOption[];
}

/**
 * Make the board's links exactly `sopIds`, in that order. Links are cheap
 * pointers with nothing hanging off them, so the set is rewritten whole
 * rather than diffed.
 */
export async function replaceBoardSops(
  db: SupabaseClient,
  boardId: string,
  sopIds: string[],
  email: string
): Promise<void> {
  const cleared = await db.from('board_sops').delete().eq('board_id', boardId);
  if (cleared.error) throw new Error(cleared.error.message);
  if (sopIds.length === 0) return;
  const inserted = await db.from('board_sops').insert(
    sopIds.map((sopId, index) => ({
      board_id: boardId,
      sop_id: sopId,
      sort_order: (index + 1) * 10,
      created_by: email,
    }))
  );
  if (inserted.error) throw new Error(inserted.error.message);
}
