// The rules for a board's `card_link` field: an answer that is cards on
// another board (or this one). Client-safe: the drawer, the card row, and the
// routes all read from here, so nothing in it may touch the database (that
// half is lib/boards/card-links.ts).
//
// A link is one row in board_card_links: (field_id, from_card_id,
// to_card_id). A field reads the rows stored under itself from the front,
// and — when it is half of a two-way pair — the rows stored under its
// inverse from the back. So "Practitioner" on the events board and "Events"
// on the practitioners board show the same rows, whichever side made them,
// and there is never a second copy to keep in step.
//
// On the wire a card's answer is what every other answer is: a value under
// the field's key in properties, here the linked card ids. The route turns
// that into rows and strips it before the card is written; the read puts it
// back from the rows. Nothing about links is ever stored on the card.

import type { BoardCardLinkRow, BoardColumnKind, BoardFieldRow } from '@/lib/db';
import { isUuid } from '@/lib/http/json';
import { cardHref } from './calendar';
import { BOARD_LIMITS } from './types';

/** The field columns the link rules need. */
export type LinkField = Pick<
  BoardFieldRow,
  | 'id'
  | 'board_id'
  | 'key'
  | 'kind'
  | 'label'
  | 'link_board_id'
  | 'link_columns'
  | 'link_multiple'
  | 'link_inverse_field_id'
>;

export type LinkRow = Pick<BoardCardLinkRow, 'field_id' | 'from_card_id' | 'to_card_id'>;

/** What the islands know about a linked card: enough to draw a chip. */
export interface LinkSummary {
  id: string;
  title: string;
  board_slug: string;
  board_name: string;
  column_key: string;
  column_label: string;
  column_kind: BoardColumnKind;
  /** Whether this viewer may open the card's board; a chip is a link only then. */
  openable: boolean;
}

/**
 * A raw `card_link` answer as the route receives it: the ids that look like
 * ids, each once, lowercased, capped. Whether they name cards the field may
 * link is the route's question (card-links.ts filterLinkAnswers).
 */
export function normalizeLinkIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = [
    ...new Set(raw.filter((id): id is string => isUuid(id)).map((id) => id.toLowerCase())),
  ].slice(0, BOARD_LIMITS.linksPerField);
  return ids.length > 0 ? ids : null;
}

/** The ids a `card_link` answer holds; [] for anything else. */
export function linkIdsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => isUuid(id)) : [];
}

export function linkFields<T extends Pick<BoardFieldRow, 'kind'>>(fields: T[]): T[] {
  return fields.filter((field) => field.kind === 'card_link');
}

/** The keys of a board's `card_link` fields, archived ones included. */
export function linkFieldKeys(fields: Pick<BoardFieldRow, 'key' | 'kind'>[]): string[] {
  return linkFields(fields).map((field) => field.key);
}

/**
 * The field ids whose rows a field reads: its own, and its inverse's when it
 * has one. The query that loads a board's links asks for all of these.
 */
export function linkFieldIds(fields: Pick<LinkField, 'id' | 'kind' | 'link_inverse_field_id'>[]) {
  const ids = new Set<string>();
  for (const field of linkFields(fields)) {
    ids.add(field.id);
    if (field.link_inverse_field_id) ids.add(field.link_inverse_field_id);
  }
  return [...ids];
}

/**
 * One row seen from one field: which card on the field's board it answers
 * (`card`), and which card it names (`other`). Null when the row is not
 * this field's to read.
 */
export function linkSeenFrom(
  field: Pick<LinkField, 'id' | 'link_inverse_field_id'>,
  row: LinkRow
): { card: string; other: string } | null {
  if (row.field_id === field.id) return { card: row.from_card_id, other: row.to_card_id };
  if (field.link_inverse_field_id && row.field_id === field.link_inverse_field_id) {
    return { card: row.to_card_id, other: row.from_card_id };
  }
  return null;
}

/**
 * Every card's `card_link` answers from a set of rows: card id -> field key
 * -> linked ids, oldest link first. A link stored from both ends (two people
 * linking the same pair from opposite boards at once) is shown once.
 */
export function linkAnswers(
  fields: Pick<LinkField, 'id' | 'key' | 'kind' | 'link_inverse_field_id'>[],
  rows: LinkRow[]
): Map<string, Record<string, string[]>> {
  const answers = new Map<string, Record<string, string[]>>();
  for (const field of linkFields(fields)) {
    for (const row of rows) {
      const seen = linkSeenFrom(field, row);
      if (!seen) continue;
      const card = answers.get(seen.card) ?? {};
      const ids = card[field.key] ?? [];
      if (!ids.includes(seen.other)) ids.push(seen.other);
      card[field.key] = ids;
      answers.set(seen.card, card);
    }
  }
  return answers;
}

/** One link a write makes or undoes, from the written card's side. */
export interface LinkChange {
  field: string;
  other: string;
}

/**
 * What a card's link answers name before and after a write, by field: the
 * links the write makes and the ones it undoes. Only fields the write
 * mentions are compared, so a PATCH of one field leaves the rest alone.
 */
export function linkDiff(
  fields: Pick<BoardFieldRow, 'key' | 'kind'>[],
  before: Record<string, unknown>,
  after: Record<string, unknown>
): { added: LinkChange[]; removed: LinkChange[] } {
  const added: LinkChange[] = [];
  const removed: LinkChange[] = [];
  for (const key of linkFieldKeys(fields)) {
    if (!(key in after)) continue;
    const was = new Set(linkIdsOf(before[key]));
    const now = new Set(linkIdsOf(after[key]));
    for (const id of now) if (!was.has(id)) added.push({ field: key, other: id });
    for (const id of was) if (!now.has(id)) removed.push({ field: key, other: id });
  }
  return { added, removed };
}

/**
 * The row a new link is stored as. A link made from either half of a pair
 * is stored under the field it was made from, card first; linkSeenFrom reads
 * it correctly from both ends, so neither half is special.
 */
export function linkRowFor(field: Pick<LinkField, 'id'>, card: string, other: string): LinkRow {
  return { field_id: field.id, from_card_id: card, to_card_id: other };
}

/**
 * Whether a stored row is the link `card` -> `other` on `field`, read from
 * either end. What an unlink deletes.
 */
export function isLinkBetween(
  field: Pick<LinkField, 'id' | 'link_inverse_field_id'>,
  row: LinkRow,
  card: string,
  other: string
): boolean {
  const seen = linkSeenFrom(field, row);
  return seen !== null && seen.card === card && seen.other === other;
}

/** Whether a card sitting in `columnKey` may be picked for this field. */
export function linkColumnAllowed(
  field: Pick<LinkField, 'link_columns'>,
  columnKey: string
): boolean {
  return field.link_columns.length === 0 || field.link_columns.includes(columnKey);
}

/**
 * Summaries with `openable` set for one viewer: a chip opens the linked card
 * only when the viewer may open its board. The title and column show either
 * way — being able to see an event is enough to see who is running it.
 */
export function markOpenable(
  summaries: LinkSummary[],
  canOpen: (slug: string) => boolean
): LinkSummary[] {
  return summaries.map((summary) => ({ ...summary, openable: canOpen(summary.board_slug) }));
}

/** Summaries by card id: how the row, the drawer, and the search look one up. */
export function summariesById(summaries: LinkSummary[] | undefined): Map<string, LinkSummary> {
  return new Map((summaries ?? []).map((summary) => [summary.id, summary]));
}

/** The titles a link answer shows, in link order; an id with no summary is skipped. */
export function linkedTitles(value: unknown, known: Map<string, LinkSummary>): string[] {
  return linkIdsOf(value).flatMap((id) => {
    const title = known.get(id)?.title;
    return title ? [title] : [];
  });
}

/** "1 card", "3 cards" — what a row shows without the titles in hand. */
export function formatLinkCount(count: number): string {
  return `${count} ${count === 1 ? 'card' : 'cards'}`;
}

/** Where a signed-in viewer opens a linked card: the board, with #card-<id> opening its drawer. */
export function linkedCardHref(summary: Pick<LinkSummary, 'id' | 'board_slug'>): string {
  return cardHref(summary.board_slug, summary.id);
}

/** Where the picker asks which cards a field may link. */
/** Whether this viewer may add a card from the field, and what that board calls one. */
export function linkCreateInfoHref(fieldId: string): string {
  return `/api/admin/board-link-options?field=${encodeURIComponent(fieldId)}&info=1`;
}

export function linkOptionsHref(fieldId: string, query = ''): string {
  const q = query.trim();
  return `/api/admin/board-link-options?field=${encodeURIComponent(fieldId)}${
    q ? `&q=${encodeURIComponent(q)}` : ''
  }`;
}
