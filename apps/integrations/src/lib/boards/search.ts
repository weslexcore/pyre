// Free-text matching for the search box on a board. Pure and client-safe:
// the cards are already on the page, so a query is answered without a round
// trip, and the same matcher can be tested without a browser.

import type { BoardCardRow, BoardFieldRow } from '@/lib/db';
import { type PeopleNames, personName } from '@/lib/sops/names';
import { checklistText } from './checklist';
import { type LinkSummary, linkedTitles } from './links';
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
 * "18:30", and a yes/no reads as "yes" rather than "true"). A link answer
 * is its linked cards' titles, when `links` has them.
 */
export function cardSearchText(
  card: Pick<
    BoardCardRow,
    'title' | 'notes_md' | 'assignee_emails' | 'waiting_on' | 'area' | 'properties'
  >,
  fields: Pick<BoardFieldRow, 'key' | 'label' | 'kind'>[],
  people: PeopleNames,
  links: Map<string, LinkSummary> = new Map()
): string {
  const parts = [card.title, card.notes_md, card.waiting_on ?? '', card.area ?? ''];
  for (const assignee of card.assignee_emails ?? []) {
    parts.push(assignee, personName(assignee, people));
  }
  for (const field of fields) {
    const value = card.properties[field.key];
    if (value == null) continue;
    if (field.kind === 'card_link') {
      parts.push(field.label, ...linkedTitles(value, links));
      continue;
    }
    if (field.kind === 'checklist') {
      parts.push(field.label, ...checklistText(value));
      continue;
    }
    parts.push(field.label, formatProperty(field, value));
    // Three kinds are shown in one shape and stored in another — a date as
    // 10.03.26, a date & time as 10.03.26 6:30 PM, a phone as (212) 555-1234
    // — and all are worth finding by either, so the stored form goes in as
    // well. A phone also goes in as bare digits, which is how somebody with
    // the number in front of them is likely to type it.
    if (field.kind === 'date' || field.kind === 'datetime') {
      for (const item of Array.isArray(value) ? value : [value]) parts.push(String(item));
    }
    if (field.kind === 'phone' && typeof value === 'string') {
      parts.push(value, value.replace(/\D/g, ''));
    }
  }
  return fold(parts.join('\n'));
}

/** True when every word of the query appears somewhere on the card. */
export function cardMatches(
  card: Parameters<typeof cardSearchText>[0],
  terms: string[],
  fields: Pick<BoardFieldRow, 'key' | 'label' | 'kind'>[],
  people: PeopleNames,
  links?: Map<string, LinkSummary>
): boolean {
  if (terms.length === 0) return true;
  const haystack = cardSearchText(card, fields, people, links);
  return terms.every((term) => haystack.includes(term));
}
