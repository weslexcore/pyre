import type { BlockContent, EmailBlock } from './schema';

// Merge fields: {{firstName}} in a subject, paragraph, button or list item is
// filled from live Momence data at send time (sample values in the preview).
// {{field|fallback}} uses the fallback when the value is empty. A field with no
// fallback and no value makes the step skip rather than send a broken
// sentence ("your credits expire on ."). Pure — shared by the editor and the
// engine.

export const MERGE_FIELDS = {
  firstName: { label: 'First name', sample: 'Julien' },
  creditsLeft: { label: 'Credits left (number)', sample: '3' },
  creditsLabel: { label: 'Credits left ("3 credits")', sample: '3 credits' },
  creditsExpireOn: { label: 'Soonest credit expiry date', sample: 'November 2' },
  introExpiresOn: { label: 'Intro offer expiry date', sample: 'October 27' },
  daysUntilIntroExpiry: { label: 'Days until intro expires', sample: '2' },
} as const;

export type MergeFieldKey = keyof typeof MERGE_FIELDS;
export type MergeValues = Partial<Record<MergeFieldKey, string>>;

export const MERGE_FIELD_KEYS = Object.keys(MERGE_FIELDS) as MergeFieldKey[];

export function sampleMergeValues(): MergeValues {
  return Object.fromEntries(MERGE_FIELD_KEYS.map((k) => [k, MERGE_FIELDS[k].sample]));
}

const TOKEN_RE = /\{\{\s*([a-zA-Z]+)\s*(?:\|([^}]*))?\}\}/g;

export function isMergeFieldKey(key: string): key is MergeFieldKey {
  return key in MERGE_FIELDS;
}

/** Field names used anywhere in a string. */
export function tokensIn(text: string): { key: string; hasFallback: boolean }[] {
  return [...text.matchAll(TOKEN_RE)].map((m) => ({ key: m[1], hasFallback: m[2] !== undefined }));
}

export function fillText(text: string, values: MergeValues, missing: Set<string>): string {
  return text.replace(TOKEN_RE, (_, key: string, fallback: string | undefined) => {
    const value = isMergeFieldKey(key) ? values[key]?.trim() : undefined;
    if (value) return value;
    if (fallback !== undefined) return fallback.trim();
    missing.add(key);
    return '';
  });
}

function blockStrings(block: EmailBlock): string[] {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
    case 'signoff':
      return [block.text];
    case 'list':
      return block.items;
    case 'button':
      return [block.label, block.url];
    case 'image':
      return [block.src, block.alt, block.href ?? ''];
    case 'divider':
      return [];
  }
}

/** Every token in the content, for save-time validation. */
export function contentTokens(content: BlockContent): { key: string; hasFallback: boolean }[] {
  return [content.subject, content.preview, ...content.blocks.flatMap(blockStrings)].flatMap(
    tokensIn
  );
}

/** Unknown field names — the editor refuses to save these. */
export function unknownTokens(content: BlockContent): string[] {
  return [...new Set(contentTokens(content).map((t) => t.key))].filter((k) => !isMergeFieldKey(k));
}

/** Fields this content needs from live data (used to skip loading what it doesn't). */
export function usedFields(content: BlockContent): Set<MergeFieldKey> {
  return new Set(
    contentTokens(content)
      .map((t) => t.key)
      .filter(isMergeFieldKey)
  );
}

export function fillContent(
  content: BlockContent,
  values: MergeValues
): { content: BlockContent; missing: string[] } {
  const missing = new Set<string>();
  const fill = (s: string) => fillText(s, values, missing);
  const blocks = content.blocks.map((block): EmailBlock => {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
      case 'signoff':
        return { ...block, text: fill(block.text) };
      case 'list':
        return { ...block, items: block.items.map(fill) };
      case 'button':
        return { ...block, label: fill(block.label), url: fill(block.url) };
      case 'image':
        return {
          ...block,
          src: fill(block.src),
          alt: fill(block.alt),
          ...(block.href !== undefined && { href: fill(block.href) }),
        };
      default:
        return block;
    }
  });
  return {
    content: { ...content, subject: fill(content.subject), preview: fill(content.preview), blocks },
    missing: [...missing],
  };
}
