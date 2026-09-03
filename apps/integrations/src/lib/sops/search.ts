// Search primitives for the SOP library, shared by the list API (which builds
// per-document context snippets server-side, after view-access filtering), the
// global search, and the islands (which highlight the term inside snippets and
// rendered documents). Case-insensitive substring matching that ignores
// spaces and hyphens, so "breakdown", "break down", and "break-down" all find
// one another — the corpus is a dozen documents, so no index or ranking is
// worth more machinery than that. Client-bundle-safe.

/** Minimum query length (ignoring spaces); shorter terms match too much. */
export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 100;

/** Characters the matcher treats as absent, in both the query and the text. */
const JOINERS = /[\s-]/;

/**
 * The regex for `term`: each character of the query (spaces and hyphens
 * dropped) may be followed by any run of spaces or hyphens in the text, so a
 * term written as one word matches the text written as two and vice versa.
 * Null when the term is empty once joiners are stripped.
 */
export function matchPattern(term: string): RegExp | null {
  const chars = [...term].filter((ch) => !JOINERS.test(ch));
  if (chars.length === 0) return null;
  const body = chars.map((ch) => ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('[\\s-]*');
  return new RegExp(body, 'gi');
}

/** The length of a query as the matcher sees it: spaces and hyphens don't count. */
export function queryLength(term: string): number {
  return [...term].filter((ch) => !JOINERS.test(ch)).length;
}

/** Whether `term` occurs anywhere in `text`. */
export function matchesTerm(text: string, term: string): boolean {
  const pattern = matchPattern(term);
  return pattern?.test(text) ?? false;
}

/** Case-insensitive occurrence count of `term` in `text`. */
export function countMatches(text: string, term: string): number {
  const pattern = matchPattern(term);
  if (!pattern) return 0;
  let count = 0;
  for (const match of text.matchAll(pattern)) {
    // A zero-width match can't happen (every term has a character), but
    // guard the loop anyway.
    if (match[0].length === 0) break;
    count++;
  }
  return count;
}

/**
 * Split `text` into segments, marking the ones that match `term`
 * (case-insensitively, original text preserved) so callers can wrap the
 * matches in <mark> elements.
 */
export function highlightSegments(text: string, term: string): { text: string; match: boolean }[] {
  const pattern = matchPattern(term);
  if (!pattern || !text) return [{ text, match: false }];

  const segments: { text: string; match: boolean }[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    const length = match[0].length;
    if (length === 0) break;
    if (index > cursor) segments.push({ text: text.slice(cursor, index), match: false });
    segments.push({ text: text.slice(index, index + length), match: true });
    cursor = index + length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments.length > 0 ? segments : [{ text, match: false }];
}

// Roughly how much context a snippet keeps around a match on a long line.
const SNIPPET_BEFORE = 60;
const SNIPPET_AFTER = 90;

/** Strip leading markdown list/heading/quote tokens so snippets read as prose. */
function cleanLine(line: string): string {
  return line
    .replace(/^[\s>]*(?:[-*+]\s+)?(?:\[[ xX]\]\s+)?/, '')
    .replace(/^#{1,6}\s+/, '')
    .trim();
}

export interface ContentSearch {
  count: number;
  /** Cleaned, match-containing lines (windowed around the match when long). */
  snippets: string[];
}

export interface ContentEntry {
  /** The cleaned, windowed line holding the match. */
  text: string;
  /**
   * Which occurrence in the document this line's first match is (0-based),
   * counting every match in every line above it. A page that marks each
   * occurrence in order can scroll straight to this one.
   */
  ordinal: number;
}

export interface EntrySearch {
  count: number;
  entries: ContentEntry[];
}

/**
 * Find `term` in a markdown document: total occurrence count plus up to
 * `maxEntries` context lines containing a match, each tagged with the
 * ordinal of its first occurrence so a link can land on that very match.
 */
export function searchEntries(content: string, term: string, maxEntries = 3): EntrySearch {
  if (queryLength(term) < MIN_QUERY_LENGTH) return { count: 0, entries: [] };
  const pattern = matchPattern(term);
  if (!pattern) return { count: 0, entries: [] };
  // A non-global copy for locating the first match on a line.
  const first = new RegExp(pattern.source, 'i');

  let count = 0;
  const entries: ContentEntry[] = [];

  for (const rawLine of content.split('\n')) {
    const lineMatches = countMatches(rawLine, term);
    if (lineMatches === 0) continue;
    const ordinal = count;
    count += lineMatches;
    if (entries.length >= maxEntries) continue;

    const line = cleanLine(rawLine);
    let hit = first.exec(line);
    // The match can vanish with the stripped tokens (e.g. searching "[ ]");
    // fall back to the raw line so the snippet still shows the hit.
    const source = hit ? line : rawLine.trim();
    if (!hit) hit = first.exec(source);
    if (!hit) continue;
    const at = hit.index;

    const start = Math.max(0, at - SNIPPET_BEFORE);
    const end = Math.min(source.length, at + hit[0].length + SNIPPET_AFTER);
    const text =
      (start > 0 ? '…' : '') + source.slice(start, end) + (end < source.length ? '…' : '');
    entries.push({ text, ordinal });
  }

  return { count, entries };
}

/**
 * Find `term` in a markdown document: total occurrence count plus up to
 * `maxSnippets` context lines containing a match.
 */
export function searchContent(content: string, term: string, maxSnippets = 3): ContentSearch {
  const { count, entries } = searchEntries(content, term, maxSnippets);
  return { count, snippets: entries.map((entry) => entry.text) };
}
