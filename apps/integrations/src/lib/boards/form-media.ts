// The image behind a board's form: where it lives and how it is addressed.
// Server-only, for the storage client; the rules a file has to meet are
// client-safe in lib/boards/forms.ts so the builder can refuse a file
// before sending it.
//
// The bucket is public (see the board_forms migration): the image is
// decoration on a page that may itself be public, so a plain URL is the
// right kind, and it is minted from the object key whenever the form is
// read rather than stored, so a moved project or a renamed bucket never
// leaves a stale link in a row.

import type { SupabaseClient } from '@supabase/supabase-js';
import { storagePathFor } from '@/lib/media/attachments';
import type { FormBackground } from './forms';

export const FORM_MEDIA_BUCKET = 'board-form-media';

/** Object key for an upload: board-forms/<board id>/<random>.<ext>. */
export function backgroundStoragePath(boardId: string, fileName: string, mime: string): string {
  return storagePathFor('board-forms', boardId, fileName, mime);
}

/** The public URL of a stored background, or null when there is none. */
export function backgroundOf(db: SupabaseClient, path: string | null): FormBackground | null {
  if (!path) return null;
  const { data } = db.storage.from(FORM_MEDIA_BUCKET).getPublicUrl(path);
  return { path, url: data.publicUrl };
}

/** Best effort: a leftover object is a wasted kilobyte, not a broken form. */
export async function removeBackgroundObject(db: SupabaseClient, path: string): Promise<void> {
  const { error } = await db.storage.from(FORM_MEDIA_BUCKET).remove([path]);
  if (error) console.warn('[board-forms] could not remove background:', error.message);
}
