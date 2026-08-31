// Attachment rules for shift-note photos and video, shared by the upload
// route and the ShiftNotes island. The acceptable-file rules — MIME types,
// the 50 MB ceiling, browser-side downscaling — are deliberately identical to
// incident media (both are "staff uploads phone media from the floor" and
// both buckets are provisioned with the same limits), so the primitives are
// re-exported from lib/incidents/media rather than copied.

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
} from '@/lib/incidents/media';

import { objectName } from '@/lib/incidents/media';

/** A note documents one shift's observation, not an evidence locker. */
export const MAX_ATTACHMENTS_PER_NOTE = 8;

/**
 * How many unclaimed staged uploads one person may hold at once. Without a
 * ceiling the no-note upload path is an authenticated but unbounded 50 MB
 * firehose; the daily sweep bounds how long orphans live, not how fast they
 * pile up. Three notes' worth is far more than a composer session needs.
 */
export const MAX_STAGED_PER_UPLOADER = 24;

/** Object key for an upload: shift-notes/<note id>/<random>.<ext>. */
export function buildNoteStoragePath(noteId: string, fileName: string, mime: string): string {
  return `shift-notes/${noteId}/${objectName(fileName, mime)}`;
}

/**
 * Object key for a staged upload (no note yet): shift-notes/staging/<random>.<ext>.
 * The key stays put when a note later claims the row — storage_path is opaque
 * (reads sign whatever the row holds), so moving the object would only add a
 * failure mode.
 */
export function buildStagedStoragePath(fileName: string, mime: string): string {
  return `shift-notes/staging/${objectName(fileName, mime)}`;
}
