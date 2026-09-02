// Internal-link autocomplete for the SOP editor. When an admin types a
// markdown link whose href starts with "/" — `[Towels](/adm` — the editor
// offers the library's documents and the admin tool pages as targets, so
// nobody has to remember a slug. Pure string work only; the dropdown itself
// lives in components/admin/SopLinkPicker.tsx. Client-bundle-safe.

export type LinkTargetKind = 'sop' | 'page';

export interface LinkTarget {
  href: string;
  title: string;
  /** Section for a document, or a short description for a page. */
  detail: string;
  /** SOP links open in the peek modal; pages navigate. */
  kind: LinkTargetKind;
}

export interface LinkContext {
  /** Index of the first href character (right after the opening paren). */
  start: number;
  /** Whatever has been typed for the href so far, "/" included. */
  query: string;
}

// The tail of the text before the caret: a markdown link's `[label](` followed
// by an href-in-progress that begins with "/" and has hit no whitespace or
// closing paren yet. The label may span brackets-free text only, so a stray
// "(" in prose (`see (/notes`) never triggers a suggestion.
const CONTEXT_RE = /\[[^[\]\n]*\]\((\/[^\s()]*)$/;

/** The link being typed at the caret, or null when the caret isn't in one. */
export function linkContextAt(text: string, caret: number): LinkContext | null {
  const match = CONTEXT_RE.exec(text.slice(0, caret));
  if (!match) return null;
  const query = match[1];
  return { start: caret - query.length, query };
}

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

/**
 * Targets that match the typed href, best first. The typed text is compared
 * to the href as a prefix (someone who already knows the path keeps typing
 * it), and to the title/detail as words (someone who doesn't types the
 * document's name after the slash). A bare "/" lists everything.
 */
export function suggestLinks(targets: LinkTarget[], query: string, limit = 8): LinkTarget[] {
  const q = normalize(query);
  // Everything after the leading slash, used for name matching, with the
  // hyphens a half-typed slug would carry treated as spaces.
  const words = q
    .replace(/^\//, '')
    .split(/[\s/-]+/)
    .filter(Boolean);
  const isPath = q.indexOf('/', 1) !== -1;

  const scored = targets
    .map((target) => {
      const href = target.href.toLowerCase();
      const name = normalize(`${target.title} ${target.detail}`);
      let score = 0;
      if (q === '/' || href.startsWith(q)) score = 3;
      // A second slash means a path is being typed, not a name: only the
      // prefix match above applies, so "/admin/w" doesn't drag in every
      // document whose slug happens to contain a "w".
      else if (isPath) score = 0;
      else if (words.length && words.every((w) => name.includes(w))) {
        // Word-start hits ("tow" → "Towels") beat mid-word ones.
        const atWordStart = words.every((w) => new RegExp(`(^|\\W)${escapeRegExp(w)}`).test(name));
        score = atWordStart ? 2 : 1;
      } else if (words.length && words.every((w) => href.includes(w))) score = 1;
      return { target, score };
    })
    .filter((entry) => entry.score > 0);

  // Stable within a score: documents before pages, then alphabetical, so the
  // "/" listing reads like the library.
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      Number(a.target.kind === 'page') - Number(b.target.kind === 'page') ||
      a.target.title.localeCompare(b.target.title)
  );
  return scored.slice(0, limit).map((entry) => entry.target);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The text with the chosen href swapped in for the partial one, closing the
 * link if it isn't already, and where the caret should land afterwards (just
 * past the closing paren).
 */
export function applyLink(
  text: string,
  context: LinkContext,
  caret: number,
  href: string
): { text: string; caret: number } {
  const after = text.slice(caret);
  const closes = after.startsWith(')');
  const insert = closes ? href : `${href})`;
  const next = text.slice(0, context.start) + insert + after;
  return { text: next, caret: context.start + href.length + 1 };
}
