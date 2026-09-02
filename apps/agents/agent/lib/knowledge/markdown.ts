// Markdown helpers for SOP content: heading anchors that match the dashboard
// renderer, section splitting so an answer can link to the part of a
// document it used, and snippet cleanup for search hits.

export interface SopSection {
  /** 1–6; 0 for the text before the first heading. */
  level: number;
  /** Heading text, '' for the preamble. */
  heading: string;
  /** Anchor id as the dashboard renders it (null for the preamble). */
  anchor: string | null;
  /** The section's markdown, heading line included. */
  markdown: string;
}

/**
 * Mirror of headingId() in the dashboard's SopMarkdown.tsx: lowercase,
 * punctuation dropped, whitespace to hyphens. Inline markdown (links, code,
 * emphasis) is reduced to its text first, which is what react-markdown
 * hands that function as string children.
 */
export function headingAnchor(heading: string): string | null {
  const text = heading
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '');
  const slug = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
  return slug.length > 0 ? slug : null;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/** Split a document into its headed sections (fenced code is not split). */
export function splitSections(markdown: string): SopSection[] {
  const sections: SopSection[] = [];
  let current: SopSection = { level: 0, heading: '', anchor: null, markdown: '' };
  let inFence = false;

  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const match = inFence ? null : HEADING_RE.exec(line);
    if (match) {
      if (current.markdown.trim().length > 0 || current.level > 0) sections.push(current);
      const heading = match[2];
      current = {
        level: match[1].length,
        heading,
        anchor: headingAnchor(heading),
        markdown: `${line}\n`,
      };
    } else {
      current.markdown += `${line}\n`;
    }
  }
  if (current.markdown.trim().length > 0 || current.level > 0) sections.push(current);
  return sections;
}

/** The words a query is really about: 3+ letters, lowercase, deduplicated. */
export function queryTerms(query: string): string[] {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3);
  return [...new Set(terms)];
}

/**
 * Which section of a document a query lands in. Heading matches decide
 * first: the section whose heading names the most query terms wins, and
 * among equals the earlier one (a document's "Cold plunge at a glance"
 * summary is the section for a cold plunge question, not the later, longer
 * chapter that mentions plunging more often). Body occurrences only settle
 * a heading tie when a later section clearly names more of the question
 * (two extra terms), and are capped so long sections cannot win by bulk.
 * Prefix match, so "plung" covers "plunge" and "plunging". Returns null when
 * nothing matches; the preamble is never returned.
 */
export function bestSection(sections: SopSection[], query: string): SopSection | null {
  const terms = queryTerms(query).map((t) => (t.length > 5 ? t.slice(0, 5) : t));
  if (terms.length === 0) return null;

  let best: SopSection | null = null;
  let bestHeading = 0;
  let bestBody = 0;
  for (const section of sections) {
    if (section.anchor === null) continue;
    const heading = section.heading.toLowerCase();
    const body = section.markdown.toLowerCase();
    let headingMatches = 0;
    let bodyScore = 0;
    for (const term of terms) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${escaped}`).test(heading)) headingMatches += 1;
      const count = body.match(new RegExp(`\\b${escaped}`, 'g'))?.length ?? 0;
      if (count > 0) bodyScore += 1 + Math.min(count, 3) / 10;
    }
    if (headingMatches === 0 && bodyScore === 0) continue;
    const wins =
      best === null ||
      headingMatches > bestHeading ||
      (headingMatches === bestHeading && bodyScore >= bestBody + 2);
    if (wins) {
      best = section;
      bestHeading = headingMatches;
      bestBody = bodyScore;
    }
  }
  return best;
}

/**
 * Turn a ts_headline fragment into readable plain text: markdown list,
 * heading, quote, emphasis, and link syntax dropped, the [[match]] markers
 * kept so the model can see what matched, whitespace collapsed.
 */
export function cleanSnippet(snippet: string, maxLength = 320): string {
  const text = snippet
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[\s>]*(?:[-*+]\s+)?(?:\[[ xX]\]\s+)?/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/** Headings as a table of contents: level, text, anchor. */
export function outline(markdown: string): Array<{ level: number; heading: string; anchor: string | null }> {
  return splitSections(markdown)
    .filter((s) => s.level > 0)
    .map(({ level, heading, anchor }) => ({ level, heading, anchor }));
}
