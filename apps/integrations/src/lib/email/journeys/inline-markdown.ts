// The markdown subset journey paragraphs accept: **bold**, *italic*, and
// [label](https://url). Anything else is literal text. Parsed into a flat
// token list so the email component can render it with React Email
// primitives (no HTML string ever reaches the email).

export type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'link'; text: string; href: string };

const INLINE_RE = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function isSafeHref(href: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(href.trim());
}

export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const index = m.index ?? 0;
    if (index > last) tokens.push({ kind: 'text', text: text.slice(last, index) });
    if (m[1] !== undefined) tokens.push({ kind: 'bold', text: m[1] });
    else if (m[2] !== undefined) tokens.push({ kind: 'italic', text: m[2] });
    else if (isSafeHref(m[4])) tokens.push({ kind: 'link', text: m[3], href: m[4] });
    else tokens.push({ kind: 'text', text: m[3] });
    last = index + m[0].length;
  }
  if (last < text.length) tokens.push({ kind: 'text', text: text.slice(last) });
  return tokens;
}

/** Blank lines split a paragraph block into separate paragraphs. */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
