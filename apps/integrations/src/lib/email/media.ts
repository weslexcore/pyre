// Photos staff upload for email (custom backgrounds, image blocks), in the
// public email-media bucket (see the email_media_bucket migration). Public
// and permanent: a sent email keeps loading its images for as long as
// someone keeps it, so nothing is deleted from here.

export const EMAIL_MEDIA_BUCKET = 'email-media';

/** What the bucket takes: the formats every mail client shows (no WebP, which desktop Outlook can't). */
export const EMAIL_MEDIA_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
};

export const EMAIL_MEDIA_MAX_BYTES = 5 * 1024 * 1024;

/** Why a file can't be used, in plain words; null when it can. Client-safe. */
export function emailMediaProblem(file: { type: string; size: number }): string | null {
  if (!EMAIL_MEDIA_TYPES[file.type]) return 'Use a JPG, PNG or GIF image.';
  if (file.size > EMAIL_MEDIA_MAX_BYTES) {
    return 'That image is over 5 MB. Make it smaller first; big images make the email slow to open.';
  }
  return null;
}

/** Where an upload is stored: by month, under a random name nobody can guess. */
export function emailMediaPath(type: string, now = new Date(), id = crypto.randomUUID()): string {
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${month}/${id}.${EMAIL_MEDIA_TYPES[type]}`;
}
