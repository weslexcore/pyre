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
