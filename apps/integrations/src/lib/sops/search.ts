// Search primitives for the SOP library, shared by the list API (which builds
// per-document context snippets server-side, after view-access filtering) and
// the islands (which highlight the term inside snippets and rendered
// documents). Plain case-insensitive substring matching — the corpus is a
// dozen documents, so no index or ranking is worth the machinery.
// Client-bundle-safe.

/** Minimum query length; shorter terms match too much to be useful. */
export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 100;

/** Case-insensitive occurrence count of `term` in `text`. */
export function countMatches(text: string, term: string): number {
  const haystack = text.toLowerCase();
  const needle = term.toLowerCase();
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * Split `text` into segments, marking the ones that equal `term`
 * (case-insensitively, original casing preserved) so callers can wrap the
 * matches in <mark> elements.
 */
export function highlightSegments(text: string, term: string): { text: string; match: boolean }[] {
  const needle = term.toLowerCase();
  if (!needle || !text) return [{ text, match: false }];

  const haystack = text.toLowerCase();
  const segments: { text: string; match: boolean }[] = [];
  let cursor = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    if (index > cursor) segments.push({ text: text.slice(cursor, index), match: false });
    segments.push({ text: text.slice(index, index + needle.length), match: true });
    cursor = index + needle.length;
    index = haystack.indexOf(needle, cursor);
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

/**
 * Find `term` in a markdown document: total occurrence count plus up to
 * `maxSnippets` context lines containing a match.
 */
export function searchContent(content: string, term: string, maxSnippets = 3): ContentSearch {
  const needle = term.toLowerCase();
  if (needle.length < MIN_QUERY_LENGTH) return { count: 0, snippets: [] };

  let count = 0;
  const snippets: string[] = [];

  for (const rawLine of content.split('\n')) {
    const lineMatches = countMatches(rawLine, term);
    if (lineMatches === 0) continue;
    count += lineMatches;
    if (snippets.length >= maxSnippets) continue;

    const line = cleanLine(rawLine);
    const index = line.toLowerCase().indexOf(needle);
    // The match can vanish with the stripped tokens (e.g. searching "[ ]");
    // fall back to the raw line so the snippet still shows the hit.
    const source = index === -1 ? rawLine.trim() : line;
    const at = index === -1 ? source.toLowerCase().indexOf(needle) : index;
    if (at === -1) continue;

    const start = Math.max(0, at - SNIPPET_BEFORE);
    const end = Math.min(source.length, at + needle.length + SNIPPET_AFTER);
    const snippet =
      (start > 0 ? '…' : '') + source.slice(start, end) + (end < source.length ? '…' : '');
    snippets.push(snippet);
  }

  return { count, snippets };
}
