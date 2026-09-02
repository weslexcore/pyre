// Detects in-library links inside SOP markdown: an href pointing at
// /admin/sops/<slug> is a reference to another document (typically a tutorial
// in the Tutorials section) and the UI opens it in a peek modal instead of
// navigating away mid-checklist. Only the full path form counts — a bare
// relative href like "momence-dirty-towels" is left alone, since it could be
// an anchor, a file, or a typo, and react-markdown resolves it unpredictably.
// Client-bundle-safe.

const PREFIX = '/admin/sops/';

// Same slug shape the sops API accepts (see lib/sops/levels.ts SLUG_RE).
// Rejects anything with a slash, so deeper admin paths never match.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Real pages under /admin/sops/ that aren't documents.
const RESERVED = new Set(['runs']);

/** The library slug an href points at, or null when it isn't an SOP link. */
export function sopSlugFromHref(href: string | undefined): string | null {
  if (!href?.startsWith(PREFIX)) return null;
  // Ignore query/hash — the modal has no use for them, and a stray ?q= from a
  // copied search URL shouldn't break the link.
  const slug = href.slice(PREFIX.length).split(/[?#]/)[0];
  if (!slug || RESERVED.has(slug) || !SLUG_RE.test(slug)) return null;
  return slug;
}

// Matches the href of every markdown link: `[label](href)`. Hrefs never
// contain whitespace or a closing paren in the documents this library holds.
const LINK_HREF_RE = /\]\(([^)\s]+)\)/g;

/**
 * The library slugs a markdown string links to, deduped, in document order.
 * Feeds two things: the server loads these documents' run state so a parent
 * checklist can show a progress bar under the item that links to a
 * sub-checklist, and ChecklistView uses it to decide which rows get one.
 */
export function linkedSopSlugs(markdown: string): string[] {
  const slugs: string[] = [];
  for (const match of markdown.matchAll(LINK_HREF_RE)) {
    const slug = sopSlugFromHref(match[1]);
    if (slug && !slugs.includes(slug)) slugs.push(slug);
  }
  return slugs;
}

/**
 * How far along a linked checklist is, as shown under the item that links to
 * it. `completed` means a run of it finished after the parent's current run
 * started — a shift's worth of "done", not all-time.
 */
export interface LinkedProgress {
  slug: string;
  /** For the cascade: checking the parent item checks every item of this run. */
  sopId: string;
  taskCount: number;
  checked: number;
  status: 'none' | 'in_progress' | 'completed';
}

/** Progress for every task-bearing document a checklist links to, by slug. */
export type LinkedProgressMap = Record<string, LinkedProgress>;
