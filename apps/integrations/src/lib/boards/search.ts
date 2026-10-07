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

/** A run of text, and whether it is one of the query's words. */
export interface TermSegment {
  text: string;
  match: boolean;
}

/**
 * `text` cut into runs, every occurrence of any of `terms` (from
 * searchTerms) marked — folded the way the matcher folds, so "jose" marks
 * the "José" it found, with the original spelling kept.
 */
export function termSegments(text: string, terms: string[]): TermSegment[] {
  if (!text || terms.length === 0) return [{ text, match: false }];
  // Fold one character at a time, remembering where each folded character
  // came from, so a match in the folded text maps back onto the original.
  let folded = '';
  const from: number[] = [];
  const to: number[] = [];
  for (let i = 0; i < text.length; ) {
    const char = String.fromCodePoint(text.codePointAt(i) ?? 0);
    const next = i + char.length;
    for (const piece of fold(char)) {
      folded += piece;
      from.push(i);
      to.push(next);
    }
    i = next;
  }
  const marked = new Array<boolean>(text.length).fill(false);
  for (const term of terms) {
    for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + term.length)) {
      for (let i = from[at]; i < to[at + term.length - 1]; i++) marked[i] = true;
    }
  }
  const segments: TermSegment[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = segments[segments.length - 1];
    if (last && last.match === marked[i]) last.text += text[i];
    else segments.push({ text: text[i], match: marked[i] });
  }
  return segments;
}

/** Whether any of `terms` occurs in `text`. */
export function hasAnyTerm(text: string, terms: string[]): boolean {
  if (!text || terms.length === 0) return false;
  const folded = fold(text);
  return terms.some((term) => folded.includes(term));
}

/**
 * The line of `text` (a card's notes) holding the first of `terms` that
 * matches, cut down to the stretch around the match, with an ellipsis where
 * it was cut. Null when no term is in it.
 */
export function termSnippet(text: string, terms: string[], before = 40, after = 80): string | null {
  for (const raw of text.split('\n')) {
    const line = raw
      .replace(/^[\s>]*(?:[-*+]\s+)?(?:\[[ xX!]\]\s+)?/, '')
      .replace(/^#{1,6}\s+/, '')
      .trim();
    const folded = fold(line);
    // Folding can shorten a line (a decomposed accent); the offset is close
    // enough to centre the excerpt, and the highlight is found afresh.
    const at = Math.min(...terms.map((term) => folded.indexOf(term)).filter((i) => i !== -1));
    if (!Number.isFinite(at)) continue;
    const start = Math.max(0, at - before);
    const end = Math.min(line.length, at + after);
    return `${start > 0 ? '…' : ''}${line.slice(start, end)}${end < line.length ? '…' : ''}`;
  }
  return null;
}
