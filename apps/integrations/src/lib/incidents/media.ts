// Attachment rules for incident photos/video. The generic half — allowed MIME
// types, the size ceiling, the downscaler, the object-name generator — is
// shared with shift-note and lost-and-found media in lib/media/attachments.ts;
// only the per-incident count and the object key prefix live here.

export {
  ACCEPT_ATTRIBUTE,
  ALLOWED_MIME_TYPES,
  ATTACHMENT_KINDS,
  type AttachmentKind,
  checkFile,
  downscaleImage,
  type FileRejection,
  formatBytes,
  kindForMime,
  MAX_FILE_BYTES,
  objectName,
} from '@/lib/media/attachments';

import { storagePathFor } from '@/lib/media/attachments';

export const MAX_ATTACHMENTS_PER_INCIDENT = 12;

/** Object key for an upload: incidents/<incident id>/<random>.<ext>. */
export function buildStoragePath(incidentId: string, fileName: string, mime: string): string {
  return storagePathFor('incidents', incidentId, fileName, mime);
}
