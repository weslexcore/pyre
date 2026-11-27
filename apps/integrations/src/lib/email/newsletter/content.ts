import { isMergeFieldKey, tokensIn } from '@/lib/email/journeys/merge-fields';
import type { BlockContent } from '@/lib/email/journeys/schema';

// Newsletter content is written in the same blocks as a journey email. It is
// rendered ONCE per issue with placeholders, and each person's copy is that
// render with their name and unsubscribe link filled in (./render.ts). So:
//   - only the first name can be filled in: credits, expiry dates and the rest
//     come from Momence at send time and only work in journeys;
//   - a field can't make one person's copy skip, as a journey step does, so
//     every field needs a fallback ({{firstName|there}});
//   - no fields inside link or image addresses, where a name would need URL
//     encoding and could break the link.
// Pure, so the editor can show the same problems the send would refuse.

/** Where each person's unsubscribe link goes in the shared render. */
export const UNSUBSCRIBE_PLACEHOLDER = '{{{UNSUBSCRIBE_URL}}}';

const FIRST_NAME_PLACEHOLDER_RE = /\{\{\{first_name\|([^}]*)\}\}\}/g;
const TOKEN_RE = /\{\{\s*([a-zA-Z]+)\s*(?:\|([^}]*))?\}\}/g;

type Located = { where: string; text: string; isAddress?: boolean };

function locate(content: BlockContent): Located[] {
  const out: Located[] = [
    { where: 'the subject', text: content.subject },
    { where: 'the preview line', text: content.preview },
  ];
  content.blocks.forEach((block, i) => {
    const where = `block ${i + 1} (${block.type})`;
    switch (block.type) {
      case 'heading':
      case 'paragraph':
      case 'signoff':
        out.push({ where, text: block.text });
        break;
      case 'list':
        for (const item of block.items) out.push({ where, text: item });
        break;
      case 'button':
        out.push({ where, text: block.label });
        out.push({ where: `${where} link`, text: block.url, isAddress: true });
        break;
      case 'image':
        out.push({ where, text: block.alt });
        out.push({ where: `${where} image address`, text: block.src, isAddress: true });
        if (block.href) out.push({ where: `${where} link`, text: block.href, isAddress: true });
        break;
      case 'divider':
        break;
    }
  });
  return out;
}

/** What stops this content going out as a newsletter, in plain words. Empty when it can. */
export function newsletterProblems(content: BlockContent): string[] {
  const problems: string[] = [];
  if (content.blocks.length === 0) problems.push('The newsletter has no content yet.');
  if (!content.subject.trim()) problems.push('The newsletter needs a subject.');
  for (const { where, text, isAddress } of locate(content)) {
    for (const { key, hasFallback } of tokensIn(text)) {
      const field = `{{${key}}}`;
      if (!isMergeFieldKey(key)) {
        problems.push(`${field} in ${where} is not a merge field.`);
      } else if (key !== 'firstName') {
        problems.push(
          `${field} in ${where} only works in journeys. A newsletter can only fill in {{firstName}}.`
        );
      } else if (isAddress) {
        problems.push(`${field} can't go in ${where}. Use it in the text of the email.`);
      } else if (!hasFallback) {
        problems.push(
          `${field} in ${where} needs a fallback for people with no name on file, like {{${key}|there}}.`
        );
      }
    }
  }
  return [...new Set(problems)];
}

/** Content with merge fields swapped for the placeholders the shared render keeps. */
export function toTemplateContent(content: BlockContent): BlockContent {
  const swap = (text: string) =>
    text.replace(TOKEN_RE, (token, key: string, fallback: string | undefined) =>
      key === 'firstName' ? `{{{first_name|${(fallback ?? '').trim()}}}}` : token
    );
  return {
    ...content,
    subject: swap(content.subject),
    preview: swap(content.preview),
    blocks: content.blocks.map((block) => {
      switch (block.type) {
        case 'heading':
        case 'paragraph':
        case 'signoff':
          return { ...block, text: swap(block.text) };
        case 'list':
          return { ...block, items: block.items.map(swap) };
        case 'button':
          return { ...block, label: swap(block.label) };
        case 'image':
          return { ...block, alt: swap(block.alt) };
        default:
          return block;
      }
    }),
  };
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

/** A name as it may appear in an email: one line, trimmed, not absurdly long. */
export function cleanFirstName(name: string | null | undefined): string | undefined {
  const clean = (name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return clean || undefined;
}

/**
 * Fills one placeholder string. `html` escapes the name for HTML; the
 * fallback was rendered by React, so in HTML it is already escaped.
 */
export function fillPlaceholders(
  text: string,
  { firstName, unsubscribeUrl }: { firstName?: string; unsubscribeUrl: string },
  html: boolean
): string {
  const name = cleanFirstName(firstName);
  return text
    .replace(FIRST_NAME_PLACEHOLDER_RE, (_, fallback: string) =>
      name ? (html ? escapeHtml(name) : name) : fallback
    )
    .split(UNSUBSCRIBE_PLACEHOLDER)
    .join(html ? escapeHtml(unsubscribeUrl) : unsubscribeUrl);
}

/** True while any placeholder is left unfilled. */
export function hasPlaceholders(text: string): boolean {
  return text.includes(UNSUBSCRIBE_PLACEHOLDER) || /\{\{\{first_name\|/.test(text);
}
