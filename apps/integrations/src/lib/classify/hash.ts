// The fingerprint of a record's text, as Jev would see it: the classifier
// skips text it has already read, and agent suggestions remember which
// version of a note they were made from. Its own module so both can import it
// without importing each other.

import { createHash } from 'node:crypto';
import { sanitizeClassifyText } from '@pyre/signals-core';

/** sha256 of the text as Jev would see it. */
export function contentHash(text: string): string {
  return createHash('sha256').update(sanitizeClassifyText(text)).digest('hex');
}
