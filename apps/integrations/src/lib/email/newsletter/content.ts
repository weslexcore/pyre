import { fillContent, isMergeFieldKey, tokensIn } from '@/lib/email/journeys/merge-fields';
import type { BlockContent } from '@/lib/email/journeys/schema';

// Newsletter content is written in the same blocks as a journey email, but it
// goes out as ONE Resend broadcast to the whole segment. So:
//   - merge fields are filled by Resend, per recipient, from the contact, and
//     only the contact's first name exists there (credits, expiry dates and
//     the rest come from Momence at send time and only work in journeys);
//   - a field can't make one recipient's copy skip, as a journey step does, so
//     every field needs a fallback ({{firstName|there}});
//   - Resend documents its variables for the body only, so none in the
//     subject or preview line, and none inside link or image addresses.
// Pure, so the editor can show the same problems the send would refuse.

/** Resend's per-recipient unsubscribe link, filled in when a broadcast goes out. */
export const RESEND_UNSUBSCRIBE_PLACEHOLDER = '{{{RESEND_UNSUBSCRIBE_URL}}}';

/** Our merge field -> the Resend contact property it becomes in a broadcast. */
const BROADCAST_FIELDS = { firstName: 'contact.first_name' } as const;

const TOKEN_RE = /\{\{\s*([a-zA-Z]+)\s*(?:\|([^}]*))?\}\}/g;

type Located = { where: string; text: string; isAddress?: boolean };

function locate(content: BlockContent): Located[] {
  const out: Located[] = [
    { where: 'the subject', text: content.subject, isAddress: true },
    { where: 'the preview line', text: content.preview, isAddress: true },
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
  for (const { where, text, isAddress } of locate(content)) {
    for (const { key, hasFallback } of tokensIn(text)) {
      const field = `{{${key}}}`;
      if (!isMergeFieldKey(key)) {
        problems.push(`${field} in ${where} is not a merge field.`);
      } else if (!(key in BROADCAST_FIELDS)) {
        problems.push(
          `${field} in ${where} only works in journeys. A newsletter goes to everyone at once, so only {{firstName}} can be filled in.`
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

/** Content with merge fields in Resend's notation, for the broadcast itself. */
export function toBroadcastContent(content: BlockContent): BlockContent {
  const swap = (text: string) =>
    text.replace(TOKEN_RE, (token, key: string, fallback: string | undefined) => {
      const property = BROADCAST_FIELDS[key as keyof typeof BROADCAST_FIELDS];
      if (!property) return token;
      return `{{{${property}|${(fallback ?? '').trim()}}}}`;
    });
  return {
    ...content,
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

/** Content as one person would read it: for the preview and test sends. */
export function personalContent(content: BlockContent, firstName?: string): BlockContent {
  return fillContent(content, { firstName: firstName?.trim() || undefined }).content;
}
