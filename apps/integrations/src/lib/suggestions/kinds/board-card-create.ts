// board_card.create: a new card on a board, made by the approving admin.

import { createCard, loadBoardFields } from '@/lib/boards/create-card';
import { loadColumns } from '@/lib/boards/store';
import { GOALS_BOARD_SLUG } from '@/lib/boards/types';
import { normalizeProperties, parseCardCreate } from '@/lib/boards/validate';
import type { BoardCardRow, BoardRow } from '@/lib/db';
import { cardHref, PAYLOAD_PARSERS } from '../types';
import { type KindHandler, originDetail } from './handler';

/** The link back, appended to the card's notes so it travels with the card. */
function withOriginLine(notes: string, origin: { label: string; href: string } | null): string {
  if (!origin) return notes;
  const line = `From [${origin.label}](${origin.href})`;
  return notes ? `${notes}\n\n${line}` : line;
}

export const boardCardCreate: KindHandler<'board_card.create'> = {
  parse: PAYLOAD_PARSERS['board_card.create'],

  async validate(db, payload) {
    const { data } = await db
      .from('boards')
      .select('id, slug, archived')
      .eq('slug', payload.board)
      .maybeSingle();
    const board = data as Pick<BoardRow, 'id' | 'slug' | 'archived'> | null;
    if (!board || board.archived) {
      return {
        ok: false,
        status: 422,
        error: `No active board "${payload.board}"; use a slug from the context, or "${GOALS_BOARD_SLUG}"`,
      };
    }

    const columnKey = payload.columnKey;
    if (columnKey) {
      const columns = await loadColumns(db, board.id);
      const column = columns.find((c) => c.key === columnKey && !c.archived);
      if (!column) {
        return { ok: false, status: 422, error: `No column "${columnKey}" on "${payload.board}"` };
      }
      // An open column, or a done one for work already finished (the card
      // is stamped complete); a dropped column is never where new work goes.
      if (column.kind === 'dropped') {
        return {
          ok: false,
          status: 422,
          error: `"${column.label}" is for dropped work; choose an open or done column`,
        };
      }
    }

    const parsed = parseCardCreate({
      title: payload.title,
      notesMd: payload.notesMd,
      dueDate: payload.dueDate,
    });
    if (!parsed.ok) return { ok: false, status: 422, error: parsed.error };

    // File answers can't be proposed (there is nothing to attach), so file
    // fields are left out before normalizing.
    const fields = (await loadBoardFields(db, board.id)).filter(
      (f) => !f.archived && f.kind !== 'files'
    );
    const properties = normalizeProperties(fields, payload.properties);
    return { ok: true, payload: { ...payload, columnKey, properties }, target: null };
  },

  async apply(db, payload, context) {
    // A retry after a crash finds the card the first attempt made.
    const { data: existing } = await db
      .from('board_cards')
      .select('id, board_id, title')
      .eq('suggestion_id', context.suggestion.id)
      .maybeSingle();
    if (existing) {
      const card = existing as Pick<BoardCardRow, 'id' | 'board_id' | 'title'>;
      const { data: board } = await db
        .from('boards')
        .select('slug')
        .eq('id', card.board_id)
        .maybeSingle();
      const slug = (board as { slug: string } | null)?.slug ?? payload.board;
      return {
        resultType: 'board_card',
        resultId: card.id,
        label: card.title,
        href: cardHref(slug, card.id),
      };
    }

    let columnId: string | null = null;
    if (payload.columnKey) {
      const { data: board } = await db
        .from('boards')
        .select('id')
        .eq('slug', payload.board)
        .maybeSingle();
      if (board) {
        const columns = await loadColumns(db, (board as { id: string }).id);
        columnId = columns.find((c) => c.key === payload.columnKey)?.id ?? null;
      }
    }

    const parsed = parseCardCreate({
      title: payload.title,
      notesMd: withOriginLine(payload.notesMd, context.origin),
      dueDate: payload.dueDate,
      columnId,
    });
    if (!parsed.ok) throw new Error(parsed.error);

    const created = await createCard(db, {
      boardSlug: payload.board,
      card: parsed.value,
      properties: payload.properties,
      actor: context.actor,
      source: 'suggestion',
      suggestionId: context.suggestion.id,
      eventDetail: originDetail(context),
    });
    if (!created.ok) throw new Error(created.error);
    return {
      resultType: 'board_card',
      resultId: created.card.id,
      label: created.card.title,
      href: cardHref(created.board.slug, created.card.id),
    };
  },
};
