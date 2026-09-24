// Attachment rules for lost-and-found photos. The generic half lives in
// lib/media/attachments.ts, shared with incident and shift-note media; only
// the per-item ceiling and the object key prefix are specific to this tool.

export {
  ACCEPT_ATTRIBUTE,
  ALLOWED_MIME_TYPES,
  type AttachmentKind,
  checkFile,
  downscaleImage,
  formatBytes,
  kindForMime,
  MAX_FILE_BYTES,
  objectName,
} from '@/lib/media/attachments';

import { ALLOWED_MIME_TYPES, storagePathFor } from '@/lib/media/attachments';

/** Private bucket the objects live in; reads are always signed URLs. */
export const LOST_FOUND_BUCKET = 'lost-found-media';

/**
 * The camera input: a still or a short clip, straight from the phone's
 * camera. `capture` on the input is what skips the library.
 */
export const CAMERA_ACCEPT = 'image/*,video/*';

/**
 * The upload input: photos and videos already on the phone. No PDFs — a
 * document helps nobody recognise a water bottle.
 */
export const LIBRARY_ACCEPT = Object.entries(ALLOWED_MIME_TYPES)
  .filter(([, kind]) => kind !== 'document')
  .map(([mime]) => mime)
  .join(',');

/**
 * A few angles of one bottle is the whole job. Lower than the incident limit
 * on purpose: this is a description aid, not an evidence locker.
 */
export const MAX_ATTACHMENTS_PER_ITEM = 6;

/** Object key for an upload: lost-found/<item id>/<random>.<ext>. */
export function buildItemStoragePath(itemId: string, fileName: string, mime: string): string {
  return storagePathFor('lost-found', itemId, fileName, mime);
}
