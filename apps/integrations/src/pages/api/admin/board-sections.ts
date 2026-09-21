// Sections on the boards index: the headings boards sit under. Rows in
// board_sections; a board points at one by section_id, so a section exists
// independently of whether anything is filed under it yet — that is what
// lets an admin add an empty section and then file boards into it.
//
//   POST   { name }        → { section } 201   (placed last)
//   PATCH  { id, name }    → { section }       (rename; boards follow the id)
//   DELETE ?id=<uuid>      → { ok: true }      (refused while boards sit in it)
//
// Ordering is /api/admin/board-order (the drag handles); this route only
// creates, renames, and removes. Reshaping the index is the whole tool's
// (canManageBoards), like every other change to a board's shape.

import { BOARDS_HREF } from '@/components/admin/adminTools';
import { canManageBoards } from '@/lib/boards/access';
import { type APIRoute, beginDelete, beginMutation, isUuidParam, json } from '@/lib/boards/route';
import { loadSection, loadSections } from '@/lib/boards/store';
import { BOARD_LIMITS } from '@/lib/boards/types';
import type { BoardSectionRow } from '@/lib/db';

/** Trimmed name, or null when it isn't a usable section name. */
function readName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  if (!name || name.length > BOARD_LIMITS.sectionName) return null;
  return name;
}

export const POST: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, body, gate } = ready;
  if (!canManageBoards(gate.access)) return json({ error: 'Forbidden' }, 403);

  const name = readName(body.name);
  if (!name) return json({ error: `name must be 1–${BOARD_LIMITS.sectionName} characters` }, 400);

  const sections = await loadSections(db);
  if (sections.some((section) => section.name.toLowerCase() === name.toLowerCase())) {
    return json({ error: `There is already a section called "${name}"` }, 409);
  }
  if (sections.length >= BOARD_LIMITS.sectionsPerIndex) {
    return json({ error: 'That is enough sections' }, 400);
  }

  const last = sections.reduce((max, section) => Math.max(max, section.sort_order), -1);
  const { data, error } = await db
    .from('board_sections')
    .insert({ name, sort_order: last + 1 })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);
  return json({ section: data as BoardSectionRow }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, body, gate } = ready;
  if (!canManageBoards(gate.access)) return json({ error: 'Forbidden' }, 403);

  if (!isUuidParam(body.id)) return json({ error: 'id must be a UUID' }, 400);
  const name = readName(body.name);
  if (!name) return json({ error: `name must be 1–${BOARD_LIMITS.sectionName} characters` }, 400);

  const section = await loadSection(db, body.id);
  if (!section) return json({ error: 'Section not found' }, 404);
  if (section.name === name) return json({ section });

  const sections = await loadSections(db);
  if (
    sections.some(
      (other) => other.id !== section.id && other.name.toLowerCase() === name.toLowerCase()
    )
  ) {
    return json({ error: `There is already a section called "${name}"` }, 409);
  }

  const { data, error } = await db
    .from('board_sections')
    .update({ name })
    .eq('id', section.id)
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);
  return json({ section: data as BoardSectionRow });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const ready = await beginDelete(cookies, request, BOARDS_HREF);
  if (ready instanceof Response) return ready;
  const { db, email, gate } = ready;
  if (!canManageBoards(gate.access)) return json({ error: 'Forbidden' }, 403);

  const id = url.searchParams.get('id');
  if (!isUuidParam(id)) return json({ error: 'id must be a UUID' }, 400);

  const section = await loadSection(db, id);
  if (!section) return json({ error: 'Section not found' }, 404);

  // Archived boards count too: a section is empty when nothing points at it.
  const { count, error: countError } = await db
    .from('boards')
    .select('id', { count: 'exact', head: true })
    .eq('section_id', id);
  if (countError) return json({ error: countError.message }, 500);
  if ((count ?? 0) > 0) {
    return json(
      {
        error: `"${section.name}" still has ${count} board${count === 1 ? '' : 's'} in it. Move them to another section first.`,
      },
      409
    );
  }

  const { error } = await db.from('board_sections').delete().eq('id', id);
  if (error) return json({ error: error.message }, 500);

  console.info(`[boards] ${email} deleted section ${section.name}`);
  return json({ ok: true });
};
