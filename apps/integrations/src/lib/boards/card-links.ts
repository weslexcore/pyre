// The rows behind a card's `card_link` answers: reading them into a card's
// properties, and keeping them saying what a write asked for. Server-only,
// for the service-role client; the rules themselves are client-safe in
// lib/boards/links.ts.
//
// Unlike a files answer, a link answer is never stored on the card. Every
// route that writes one runs the same three steps around its write:
//
//   1. prepareLinks  — before: check each link the write adds (a real card,
//                      on the field's board, in a column it may be picked
//                      from, and room for it at both ends), and take the
//                      link keys out of the properties about to be stored;
//   2. applyLinks    — after: insert and delete rows so the card links what
//                      it asked to, and write `linked` / `unlinked` on both
//                      cards' trails;
//   3. withLinks     — put the answers back on the card the route returns,
//                      read from the rows, so the island sees what is true.
//
// A route that should not write links at all (a public form, intake, an
// agent suggestion) drops the keys with withoutLinks instead.

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BoardCardLinkRow,
  BoardCardRow,
  BoardColumnRow,
  BoardFieldRow,
  BoardFieldValue,
  BoardRow,
} from '@/lib/db';
import type { BoardEventInput } from './events';
import { logBoardEvents } from './events';
import {
  isLinkBetween,
  type LinkChange,
  type LinkField,
  type LinkSummary,
  linkAnswers,
  linkColumnAllowed,
  linkDiff,
  linkFieldIds,
  linkFieldKeys,
  linkFields,
  linkIdsOf,
  linkRowFor,
  linkSeenFrom,
} from './links';

/** PostgREST puts `in` lists in the URL; keep each one short. */
const IN_CHUNK = 150;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += IN_CHUNK) out.push(items.slice(i, i + IN_CHUNK));
  return out;
}

/** Properties with every card_link key taken out: what is stored on a card. */
export function withoutLinks(
  fields: Pick<BoardFieldRow, 'key' | 'kind'>[],
  properties: Record<string, BoardFieldValue>
): Record<string, BoardFieldValue> {
  const keys = linkFieldKeys(fields);
  if (keys.length === 0) return properties;
  const next = { ...properties };
  for (const key of keys) delete next[key];
  return next;
}

/** Every link row the given fields read, from either end. */
export async function loadLinkRows(
  db: SupabaseClient,
  fields: Pick<LinkField, 'id' | 'kind' | 'link_inverse_field_id'>[]
): Promise<BoardCardLinkRow[]> {
  const ids = linkFieldIds(fields);
  if (ids.length === 0) return [];
  const { data, error } = await db
    .from('board_card_links')
    .select('*')
    .in('field_id', ids)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BoardCardLinkRow[];
}

/** One card's link rows, from either end, for the given fields. */
async function loadCardLinkRows(
  db: SupabaseClient,
  fields: Pick<LinkField, 'id' | 'kind' | 'link_inverse_field_id'>[],
  cardIds: string[]
): Promise<BoardCardLinkRow[]> {
  const ids = linkFieldIds(fields);
  const cards = [...new Set(cardIds)];
  if (ids.length === 0 || cards.length === 0) return [];
  const rows: BoardCardLinkRow[] = [];
  for (const part of chunks(cards)) {
    const list = part.join(',');
    const { data, error } = await db
      .from('board_card_links')
      .select('*')
      .in('field_id', ids)
      .or(`from_card_id.in.(${list}),to_card_id.in.(${list})`)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as BoardCardLinkRow[]));
  }
  // A row can match two chunks (one end in each); keep it once.
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

/**
 * Cards' properties with their link answers put back, read from the rows.
 * What every read that hands cards to an island goes through.
 */
export async function withLinks<T extends Pick<BoardCardRow, 'id' | 'properties'>>(
  db: SupabaseClient,
  fields: LinkField[],
  cards: T[],
  rows?: BoardCardLinkRow[]
): Promise<T[]> {
  if (linkFields(fields).length === 0 || cards.length === 0) return cards;
  const read =
    rows ??
    (await loadCardLinkRows(
      db,
      fields,
      cards.map((card) => card.id)
    ));
  const answers = linkAnswers(fields, read);
  return cards.map((card) => {
    const linked = answers.get(card.id);
    const properties = withoutLinks(fields, card.properties);
    return linked ? { ...card, properties: { ...properties, ...linked } } : { ...card, properties };
  });
}

/**
 * What a chip needs about each linked card: its title, and its board and
 * column. `openable` is false here; the route that knows the viewer sets it
 * (people.ts boardViewerExtras).
 */
export async function loadLinkSummaries(
  db: SupabaseClient,
  cardIds: string[]
): Promise<LinkSummary[]> {
  const ids = [...new Set(cardIds)];
  if (ids.length === 0) return [];

  const cards: Pick<BoardCardRow, 'id' | 'title' | 'board_id' | 'column_id'>[] = [];
  for (const part of chunks(ids)) {
    const { data, error } = await db
      .from('board_cards')
      .select('id, title, board_id, column_id')
      .in('id', part);
    if (error) throw new Error(error.message);
    cards.push(...((data ?? []) as typeof cards));
  }
  if (cards.length === 0) return [];

  const boardIds = [...new Set(cards.map((card) => card.board_id))];
  const [boardsResult, columnsResult] = await Promise.all([
    db.from('boards').select('id, slug, name').in('id', boardIds),
    db.from('board_columns').select('id, key, label, kind').in('board_id', boardIds),
  ]);
  if (boardsResult.error) throw new Error(boardsResult.error.message);
  if (columnsResult.error) throw new Error(columnsResult.error.message);
  const boards = new Map(
    ((boardsResult.data ?? []) as Pick<BoardRow, 'id' | 'slug' | 'name'>[]).map((board) => [
      board.id,
      board,
    ])
  );
  const columns = new Map(
    ((columnsResult.data ?? []) as Pick<BoardColumnRow, 'id' | 'key' | 'label' | 'kind'>[]).map(
      (column) => [column.id, column]
    )
  );

  return cards.flatMap((card) => {
    const board = boards.get(card.board_id);
    const column = columns.get(card.column_id);
    if (!board || !column) return [];
    return [
      {
        id: card.id,
        title: card.title,
        board_slug: board.slug,
        board_name: board.name,
        column_key: column.key,
        column_label: column.label,
        column_kind: column.kind,
        openable: false,
      },
    ];
  });
}

/** The summaries for every card the given cards' link answers name. */
export async function loadLinkedSummaries(
  db: SupabaseClient,
  fields: Pick<BoardFieldRow, 'key' | 'kind'>[],
  cards: Pick<BoardCardRow, 'properties'>[]
): Promise<LinkSummary[]> {
  const keys = linkFieldKeys(fields);
  if (keys.length === 0) return [];
  return loadLinkSummaries(
    db,
    cards.flatMap((card) => keys.flatMap((key) => linkIdsOf(card.properties[key])))
  );
}

/** The field ids a set of fields points at as inverses, loaded. */
async function loadInverseFields(
  db: SupabaseClient,
  fields: LinkField[]
): Promise<Map<string, BoardFieldRow>> {
  const ids = [
    ...new Set(
      linkFields(fields)
        .map((field) => field.link_inverse_field_id)
        .filter((id): id is string => id !== null)
    ),
  ];
  if (ids.length === 0) return new Map();
  const { data, error } = await db.from('board_fields').select('*').in('id', ids);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as BoardFieldRow[]).map((field) => [field.id, field]));
}

/** A write's links, checked and ready for applyLinks. */
export interface PreparedLinks {
  /** The card's current rows for the fields the write mentions. */
  rows: BoardCardLinkRow[];
  added: LinkChange[];
  removed: LinkChange[];
  /** The added cards, for the trail. */
  targets: Map<string, Pick<BoardCardRow, 'id' | 'title' | 'board_id'>>;
  inverses: Map<string, BoardFieldRow>;
}

export type PrepareResult =
  | { ok: true; properties: Record<string, BoardFieldValue>; links: PreparedLinks | null }
  | { ok: false; error: string };

/**
 * Before a card is written: check the links its normalized properties ask
 * for, and hand back the properties to store (link keys removed) with what
 * applyLinks will do. `cardId` is null for a card that does not exist yet.
 *
 * Refused, with words a person can act on: a single-card field given more
 * than one; a card the field may not link (another board, a column outside
 * the ones it offers, or a card that doesn't exist); and a card whose own
 * end of a two-way pair is single and already taken. A link that already
 * exists is never re-checked, so a practitioner moved to Inactive stays on
 * last month's event.
 */
export async function prepareLinks(
  db: SupabaseClient,
  cardId: string | null,
  fields: BoardFieldRow[],
  normalized: Record<string, BoardFieldValue>,
  /**
   * The properties as the request sent them. normalizeProperties drops a key
   * sent as null, and for a link field a null is the whole message — unlink
   * everything — so which fields a write mentions is read from here.
   */
  raw: unknown
): Promise<PrepareResult> {
  const sent =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const mentioned = linkFields(fields).filter((field) => field.key in sent);
  const stored = withoutLinks(fields, normalized);
  if (mentioned.length === 0) return { ok: true, properties: stored, links: null };
  // Every mentioned field has a key here, cleared ones as null, so linkDiff
  // sees "nothing" rather than "not mentioned".
  const properties: Record<string, BoardFieldValue | null> = Object.fromEntries(
    mentioned.map((field) => [field.key, normalized[field.key] ?? null])
  );

  for (const field of mentioned) {
    if (!field.link_multiple && linkIdsOf(properties[field.key]).length > 1) {
      return { ok: false, error: `"${field.label}" links one card at most` };
    }
    if (cardId !== null && linkIdsOf(properties[field.key]).includes(cardId)) {
      return { ok: false, error: `A card can't be linked to itself` };
    }
  }

  const rows = cardId === null ? [] : await loadCardLinkRows(db, mentioned, [cardId]);
  const current: Record<string, string[]> =
    cardId === null ? {} : (linkAnswers(mentioned, rows).get(cardId) ?? {});
  const { added, removed } = linkDiff(mentioned, current, properties);

  const targets = new Map<string, Pick<BoardCardRow, 'id' | 'title' | 'board_id'>>();
  const inverses = await loadInverseFields(db, mentioned);
  if (added.length === 0) {
    return { ok: true, properties: stored, links: { rows, added, removed, targets, inverses } };
  }

  const addedIds = [...new Set(added.map((change) => change.other))];
  const cards: Pick<BoardCardRow, 'id' | 'title' | 'board_id' | 'column_id'>[] = [];
  for (const part of chunks(addedIds)) {
    const { data, error } = await db
      .from('board_cards')
      .select('id, title, board_id, column_id')
      .in('id', part);
    if (error) throw new Error(error.message);
    cards.push(...((data ?? []) as typeof cards));
  }
  const byId = new Map(cards.map((card) => [card.id, card]));

  const columnIds = [...new Set(cards.map((card) => card.column_id))];
  const { data: columnData, error: columnError } =
    columnIds.length === 0
      ? { data: [], error: null }
      : await db.from('board_columns').select('id, key, label').in('id', columnIds);
  if (columnError) throw new Error(columnError.message);
  const columns = new Map(
    ((columnData ?? []) as Pick<BoardColumnRow, 'id' | 'key' | 'label'>[]).map((column) => [
      column.id,
      column,
    ])
  );

  const byKey = new Map(mentioned.map((field) => [field.key, field]));
  for (const change of added) {
    const field = byKey.get(change.field);
    const card = byId.get(change.other);
    if (!field || !card || card.board_id !== field.link_board_id) {
      return { ok: false, error: `"${field?.label ?? change.field}" can't link that card` };
    }
    const column = columns.get(card.column_id);
    if (!column || !linkColumnAllowed(field, column.key)) {
      return {
        ok: false,
        error: `"${card.title}" is in ${column?.label ?? 'a column'}, which "${field.label}" doesn't link from`,
      };
    }
    targets.set(card.id, card);
  }

  // The far end's limit: a practitioner whose Events field is single already
  // on another event. Only pairs with a single inverse need the read.
  const singleEnds = mentioned.filter((field) => {
    const inverse = field.link_inverse_field_id ? inverses.get(field.link_inverse_field_id) : null;
    return inverse !== null && inverse !== undefined && !inverse.link_multiple;
  });
  if (singleEnds.length > 0) {
    const checks = added.filter((change) => singleEnds.some((field) => field.key === change.field));
    const farRows = await loadCardLinkRows(
      db,
      singleEnds,
      checks.map((change) => change.other)
    );
    for (const change of checks) {
      const field = byKey.get(change.field) as BoardFieldRow;
      const inverse = inverses.get(field.link_inverse_field_id as string) as BoardFieldRow;
      const taken = farRows.some((row) => {
        const seen = linkSeenFrom(inverse, row);
        return seen !== null && seen.card === change.other && seen.other !== cardId;
      });
      if (taken) {
        const title = targets.get(change.other)?.title ?? 'That card';
        return {
          ok: false,
          error: `${title} already has a card under "${inverse.label}", which holds one`,
        };
      }
    }
  }

  return { ok: true, properties: stored, links: { rows, added, removed, targets, inverses } };
}

/**
 * After a card is written: make and undo the rows prepareLinks checked, and
 * put a line on both cards' trails. Failures are logged rather than thrown,
 * the bargain the files half makes — the card itself is already saved, and
 * the answer the island gets back is read from the rows (withLinks), so a
 * link that failed to save shows as not saved.
 */
export async function applyLinks(
  db: SupabaseClient,
  card: Pick<BoardCardRow, 'id' | 'title'>,
  fields: BoardFieldRow[],
  links: PreparedLinks | null,
  actor: string
): Promise<void> {
  if (!links || (links.added.length === 0 && links.removed.length === 0)) return;
  const byKey = new Map(linkFields(fields).map((field) => [field.key, field]));
  const events: BoardEventInput[] = [];

  // The far card's side of the line: the field it shows the link under, if
  // the pair has one there; a one-way link still lands on its trail.
  const far = (field: BoardFieldRow): { field: string | null; label: string | null } => {
    const inverse = field.link_inverse_field_id
      ? links.inverses.get(field.link_inverse_field_id)
      : undefined;
    return { field: inverse?.key ?? null, label: inverse?.label ?? null };
  };

  if (links.removed.length > 0) {
    const doomed = links.removed.flatMap((change) => {
      const field = byKey.get(change.field);
      if (!field) return [];
      return links.rows.filter((row) => isLinkBetween(field, row, card.id, change.other));
    });
    const ids = [...new Set(doomed.map((row) => row.id))];
    if (ids.length > 0) {
      const { error } = await db.from('board_card_links').delete().in('id', ids);
      if (error) {
        console.error('[board-links] unlink failed:', error.message);
      } else {
        const { data } = await db
          .from('board_cards')
          .select('id, title')
          .in(
            'id',
            links.removed.map((change) => change.other)
          );
        const titles = new Map(
          ((data ?? []) as Pick<BoardCardRow, 'id' | 'title'>[]).map((row) => [row.id, row.title])
        );
        for (const change of links.removed) {
          const field = byKey.get(change.field);
          if (!field) continue;
          events.push(
            {
              cardId: card.id,
              action: 'unlinked',
              actor,
              detail: {
                field: field.key,
                label: field.label,
                card_id: change.other,
                title: titles.get(change.other),
              },
            },
            {
              cardId: change.other,
              action: 'unlinked',
              actor,
              detail: { ...far(field), card_id: card.id, title: card.title },
            }
          );
        }
      }
    }
  }

  if (links.added.length > 0) {
    const inserts = links.added.flatMap((change) => {
      const field = byKey.get(change.field);
      return field ? [{ ...linkRowFor(field, card.id, change.other), created_by: actor }] : [];
    });
    const { error } = await db
      .from('board_card_links')
      .upsert(inserts, { onConflict: 'field_id,from_card_id,to_card_id', ignoreDuplicates: true });
    if (error) {
      console.error('[board-links] link failed:', error.message);
    } else {
      for (const change of links.added) {
        const field = byKey.get(change.field);
        if (!field) continue;
        events.push(
          {
            cardId: card.id,
            action: 'linked',
            actor,
            detail: {
              field: field.key,
              label: field.label,
              card_id: change.other,
              title: links.targets.get(change.other)?.title,
            },
          },
          {
            cardId: change.other,
            action: 'linked',
            actor,
            detail: { ...far(field), card_id: card.id, title: card.title },
          }
        );
      }
    }
  }

  await logBoardEvents(db, events);
}
