// Reorder controls for the boards index. One PUT accepting either or both
// shapes, always the full order (not a delta), so positions self-normalise
// even where historical sort orders had gaps or ties:
//
//   { sectionIds: string[] }                 — every heading, top to bottom
//   { sectionId: string | null, boardIds }   — every board under one heading,
//                                              which also files them there
//
// The second shape is how a drag between sections lands: the board is
// re-filed and placed in one write, so a drop never leaves a board in the
// old section with the new position. updated_by is left alone — a reorder
// is not an edit.

import { BOARDS_HREF } from '@/components/admin/adminTools';
import { canManageBoards } from '@/lib/boards/access';
import { type APIRoute, beginMutation, isUuidParam, json } from '@/lib/boards/route';
import { loadSection, loadSections } from '@/lib/boards/store';
import { BOARD_LIMITS } from '@/lib/boards/types';

function uniqueUuids(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) return null;
  if (!value.every(isUuidParam)) return null;
  if (new Set(value).size !== value.length) return null;
  return value;
}

export const PUT: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, body, gate } = ready;
  if (!canManageBoards(gate.access)) return json({ error: 'Forbidden' }, 403);

  const hasSections = body.sectionIds !== undefined;
  const hasBoards = body.boardIds !== undefined;
  if (!hasSections && !hasBoards) {
    return json({ error: 'Provide sectionIds and/or sectionId + boardIds' }, 400);
  }

  if (hasSections) {
    const ids = uniqueUuids(body.sectionIds, BOARD_LIMITS.sectionsPerIndex);
    if (!ids) return json({ error: 'sectionIds must be a non-empty list of unique UUIDs' }, 400);
    const known = new Set((await loadSections(db)).map((section) => section.id));
    if (!ids.every((id) => known.has(id))) return json({ error: 'Unknown section' }, 400);
    for (const [index, id] of ids.entries()) {
      const { error } = await db.from('board_sections').update({ sort_order: index }).eq('id', id);
      if (error) return json({ error: error.message }, 500);
    }
  }

  if (hasBoards) {
    const ids = uniqueUuids(body.boardIds, BOARD_LIMITS.boardsPerSection);
    if (!ids) return json({ error: 'boardIds must be a non-empty list of unique UUIDs' }, 400);
    let sectionId: string | null = null;
    if (body.sectionId !== undefined && body.sectionId !== null && body.sectionId !== '') {
      if (!isUuidParam(body.sectionId)) return json({ error: 'sectionId must be a UUID' }, 400);
      if (!(await loadSection(db, body.sectionId)))
        return json({ error: 'Section not found' }, 404);
      sectionId = body.sectionId;
    }
    for (const [index, id] of ids.entries()) {
      const { error } = await db
        .from('boards')
        .update({ section_id: sectionId, sort_order: (index + 1) * 10 })
        .eq('id', id);
      if (error) return json({ error: error.message }, 500);
    }
  }

  return json({ ok: true });
};
