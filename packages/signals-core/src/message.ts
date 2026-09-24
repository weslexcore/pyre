// The opening message of a classifier session. The integrations app builds
// it; the agents app's prompt describes the same shape. The text is staff-
// written and goes to the model as data, fenced in a <text> block that the
// text itself cannot close early.

import type { SubjectType } from './subjects';

/** The longest text sent for classification — the shift note body cap. */
export const MAX_CLASSIFY_TEXT = 8000;

/** The tag the whole request is wrapped in. */
export const CLASSIFY_TAG = 'classify';

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Either delimiter the request uses, open or close, so the text cannot fake one. */
const DELIMITERS = /<\/?\s*(?:classify|text)\b[^>]*>?/gi;

/** Drop control characters and neutralise the request's delimiters; trim and cap. */
export function sanitizeClassifyText(raw: string): string {
  return raw
    .replace(DELIMITERS, '')
    .replace(CONTROL_CHARS, '')
    .trim()
    .slice(0, MAX_CLASSIFY_TEXT)
    .trim();
}

/**
 * The classifier's opening message for one piece of text:
 *
 *   <classify subject="shift_note">
 *   <text>
 *   ...
 *   </text>
 *   </classify>
 */
export function buildClassifyMessage(subject: SubjectType, text: string): string {
  return [
    `<${CLASSIFY_TAG} subject="${subject}">`,
    '<text>',
    sanitizeClassifyText(text),
    '</text>',
    `</${CLASSIFY_TAG}>`,
  ].join('\n');
}
