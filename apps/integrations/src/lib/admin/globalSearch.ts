// The global search (cmd+K on desktop, the magnifier in the header on every
// screen): what the palette matches locally, what it asks the server for, and
// how the two are ranked into one keyboard-navigable list. Pages match on the
// client — the palette already holds the list of pages this user may open —
// and land first; SOP documents, entries inside them, and shift notes come
// from /api/admin/search, which filters by the same access rules the
// individual tools use. Client-bundle-safe.

import type { SearchPage } from '@/components/admin/adminTools';
import { MIN_QUERY_LENGTH } from '@/lib/sops/search';

export { MIN_QUERY_LENGTH };

/** One SOP document the server matched, with the entries inside it. */
export interface SopHit {
  id: string;
  slug: string;
  title: string;
  category: string;
  archived: boolean;
  titleMatch: boolean;
  matchCount: number;
  entries: { text: string; ordinal: number }[];
}

/** One shift note the server matched. */
export interface NoteHit {
  id: string;
  note_date: string;
  author_email: string;
  /** Roster name for the author, resolved server-side. */
  author: string;
  snippet: string;
}

/** /api/admin/search's response. */
export interface SearchResponse {
  q: string;
  sops: SopHit[];
  notes: NoteHit[];
}

export type SearchGroup = 'pages' | 'sops' | 'entries' | 'notes';

export const GROUP_LABELS: Record<SearchGroup, string> = {
  pages: 'Pages',
  sops: 'SOPs',
  entries: 'In SOPs',
  notes: 'Shift notes',
};

/** One row of the palette, whatever it came from. */
export interface SearchItem {
  /** Stable across re-renders so the selected row survives a refetch. */
  key: string;
  group: SearchGroup;
  href: string;
  /** Main line, highlighted where the term appears. */
  title: string;
  /** Where it lives — section, parent tool, SOP category, note author. */
  hint: string;
  /** Second line for entries and notes: the matched text, highlighted. */
  snippet?: string;
  /** Third line of context (archived flag, match count). */
  meta?: string;
}

/**
 * Pages whose title, alias, or description contains the query, best match
 * first: a title that starts with the term, then a title containing it, then
 * an alias, then the description. Ties keep the registry order, which is the
 * dashboard's.
 */
export function matchPages(pages: SearchPage[], query: string): SearchPage[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const ranked: { page: SearchPage; rank: number }[] = [];
  for (const page of pages) {
    const title = page.title.toLowerCase();
    let rank: number;
    if (title.startsWith(q)) rank = 0;
    else if (title.includes(q)) rank = 1;
    else if (page.keywords.some((keyword) => keyword.toLowerCase().includes(q))) rank = 2;
    else if (page.description?.toLowerCase().includes(q)) rank = 3;
    else continue;
    ranked.push({ page, rank });
  }
  // Stable sort: equal ranks stay in registry order.
  return ranked.sort((a, b) => a.rank - b.rank).map((entry) => entry.page);
}

/** Link to an SOP with the term highlighted, landing on match `ordinal`. */
export function sopEntryHref(slug: string, term: string, ordinal?: number): string {
  const params = new URLSearchParams({ q: term });
  if (ordinal !== undefined && ordinal > 0) params.set('m', String(ordinal));
  return `/admin/sops/${slug}?${params}`;
}

/** Link to the shift-note log filtered to the term, scrolled to one note. */
export function noteHref(id: string, term: string): string {
  return `/admin/shift-notes?${new URLSearchParams({ q: term })}#note-${id}`;
}

/**
 * The palette's rows in display order: pages first (matched locally), then
 * SOP documents whose title matched, then the matched entries inside every
 * SOP the server returned, then shift notes. A document that matched only in
 * its body doesn't get a document row of its own — its entries are the more
 * useful thing to land on, and they name the document.
 */
export function buildItems(
  pages: SearchPage[],
  server: SearchResponse | null,
  query: string
): SearchItem[] {
  const term = query.trim();
  // Nothing typed yet: the palette doubles as a jump list of every page.
  const matched = term ? matchPages(pages, term) : pages;
  const items: SearchItem[] = matched.map((page) => ({
    key: `page:${page.href}`,
    group: 'pages',
    href: page.href,
    title: page.title,
    hint: page.hint,
  }));
  if (!server || !term) return items;

  for (const sop of server.sops) {
    if (!sop.titleMatch) continue;
    items.push({
      key: `sop:${sop.id}`,
      group: 'sops',
      href: sopEntryHref(sop.slug, term),
      title: sop.title,
      hint: sop.category,
      meta: sop.archived ? 'archived' : undefined,
    });
  }
  for (const sop of server.sops) {
    for (const entry of sop.entries) {
      items.push({
        key: `entry:${sop.id}:${entry.ordinal}`,
        group: 'entries',
        href: sopEntryHref(sop.slug, term, entry.ordinal),
        title: sop.title,
        hint: sop.category,
        snippet: entry.text,
        meta: sop.archived ? 'archived' : undefined,
      });
    }
  }
  for (const note of server.notes) {
    items.push({
      key: `note:${note.id}`,
      group: 'notes',
      href: noteHref(note.id, term),
      title: note.author,
      hint: note.note_date,
      snippet: note.snippet,
    });
  }
  return items;
}
