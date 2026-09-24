// The text a classification reads, normalised the same way on both sides:
// the integrations app hashes it (so unchanged text is never re-read) and the
// agents app sends it to Jev.

/** The longest text sent for classification — the shift note body cap. */
export const MAX_CLASSIFY_TEXT = 8000;

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Drop control characters, trim, and cap. */
export function sanitizeClassifyText(raw: string): string {
  return raw.replace(CONTROL_CHARS, '').trim().slice(0, MAX_CLASSIFY_TEXT).trim();
}
