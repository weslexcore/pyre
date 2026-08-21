// Attachment rules for incident photos/video, shared by the upload route and
// the form island so both agree on what is acceptable before a byte moves.
// The downscale helper is browser-only by use (it touches document/canvas
// inside the function body, never at import time), which keeps this module
// safe to import from a server route.

export const ATTACHMENT_KINDS = ['photo', 'video', 'document'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/** Mirrors allowed_mime_types on the incident-media bucket. */
export const ALLOWED_MIME_TYPES: Record<string, AttachmentKind> = {
  'image/jpeg': 'photo',
  'image/png': 'photo',
  'image/webp': 'photo',
  'image/heic': 'photo',
  'image/heif': 'photo',
  'image/gif': 'photo',
  'video/mp4': 'video',
  'video/quicktime': 'video',
  'video/webm': 'video',
  'application/pdf': 'document',
};

/** Same ceiling as the bucket's file_size_limit — 50 MB. */
export const MAX_FILE_BYTES = 52_428_800;
export const MAX_ATTACHMENTS_PER_INCIDENT = 12;

/** What the file picker offers; `capture` on the photo input opens the camera. */
export const ACCEPT_ATTRIBUTE = Object.keys(ALLOWED_MIME_TYPES).join(',');

export function kindForMime(mime: string): AttachmentKind | null {
  return ALLOWED_MIME_TYPES[mime.toLowerCase().split(';')[0].trim()] ?? null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * `<random>.<ext>` object name for an upload. The original file name is kept
 * in the attachment row, not the path — phone camera names collide constantly
 * and can carry anything. Shared with shift-note media.
 */
export function objectName(fileName: string, mime: string): string {
  const extFromName = fileName.includes('.') ? (fileName.split('.').pop() ?? '') : '';
  const ext = /^[a-zA-Z0-9]{1,5}$/.test(extFromName)
    ? extFromName.toLowerCase()
    : (mime.split('/')[1] ?? 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'bin';
  const id =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${id}.${ext}`;
}

/** Object key for an upload: incidents/<incident id>/<random>.<ext>. */
export function buildStoragePath(incidentId: string, fileName: string, mime: string): string {
  return `incidents/${incidentId}/${objectName(fileName, mime)}`;
}

/** Longest edge a re-encoded photo keeps — plenty to read a wet floor or a burn. */
const MAX_IMAGE_EDGE = 2000;
/** Below this, re-encoding costs quality and saves nothing worth having. */
const DOWNSCALE_THRESHOLD_BYTES = 1_500_000;

/**
 * Shrink a phone photo before upload so filing a report over the site's
 * wifi doesn't stall on a 12 MP original. Returns the file untouched when it
 * is already small, isn't a re-encodable image, or the browser can't decode
 * it (HEIC outside Safari) — the upload still works, it's just bigger.
 */
export async function downscaleImage(file: File): Promise<File> {
  const kind = kindForMime(file.type);
  if (kind !== 'photo') return file;
  if (file.type === 'image/gif') return file; // animation would be flattened
  if (file.size <= DOWNSCALE_THRESHOLD_BYTES) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.82);
    });
    if (!blob || blob.size >= file.size) return file;

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${baseName}.jpg`, {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}

export interface FileRejection {
  file: File;
  reason: string;
}

/** Client-side pre-check so a bad file is reported instantly, not after upload. */
export function checkFile(file: File): string | null {
  if (!kindForMime(file.type)) {
    return `${file.name}: unsupported file type (${file.type || 'unknown'})`;
  }
  if (file.size > MAX_FILE_BYTES) {
    return `${file.name}: ${formatBytes(file.size)} is over the ${formatBytes(MAX_FILE_BYTES)} limit`;
  }
  if (file.size === 0) return `${file.name}: file is empty`;
  return null;
}
