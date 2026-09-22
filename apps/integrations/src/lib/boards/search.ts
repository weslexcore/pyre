// Free-text matching for the search box on a board. Pure and client-safe:
// the cards are already on the page, so a query is answered without a round
// trip, and the same matcher can be tested without a browser.

import type { BoardCardRow, BoardFieldRow } from '@/lib/db';
import { type PeopleNames, personName } from '@/lib/sops/names';
import { formatProperty } from './validate';

/** Lowercased, accents stripped, so "Jose" finds "José" and vice versa. */
function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** The query as the words to look for; empty when there is nothing to search. */
export function searchTerms(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

/**
 * Everything on a card a person might type to find it: the title, the
 * notes, who owns it and what it is waiting on, its area, and each field's
 * answer the way the card shows it (so "6:30 PM" finds a time stored as
 * "18:30", and a yes/no reads as "yes" rather than "true").
 */
export function cardSearchText(
  card: Pick<
    BoardCardRow,
    'title' | 'notes_md' | 'owner_email' | 'waiting_on' | 'area' | 'properties'
  >,
  fields: Pick<BoardFieldRow, 'key' | 'label' | 'kind'>[],
  people: PeopleNames
): string {
  const parts = [card.title, card.notes_md, card.waiting_on ?? '', card.area ?? ''];
  if (card.owner_email) parts.push(card.owner_email, personName(card.owner_email, people));
  for (const field of fields) {
    const value = card.properties[field.key];
    if (value == null) continue;
    parts.push(field.label, formatProperty(field, value));
  }
  return fold(parts.join('\n'));
}

/** True when every word of the query appears somewhere on the card. */
export function cardMatches(
  card: Parameters<typeof cardSearchText>[0],
  terms: string[],
  fields: Pick<BoardFieldRow, 'key' | 'label' | 'kind'>[],
  people: PeopleNames
): boolean {
  if (terms.length === 0) return true;
  const haystack = cardSearchText(card, fields, people);
  return terms.every((term) => haystack.includes(term));
}
