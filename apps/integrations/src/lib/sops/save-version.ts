// Saving a new version of an SOP, wherever the edit came from: the document
// editor (PUT /api/admin/sops) and an admin approving an agent's suggested
// edit (lib/suggestions/kinds/sop-edit.ts). Server-only.
//
// Optimistic-locked on the version the edit was made against: a mismatch
// means someone saved in between, and is reported rather than overwritten.
// The history row goes in first — its (sop_id, version) unique constraint is
// the race guard: two saves can both pass the version check, but only one
// insert of version N succeeds.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SopRow } from '@/lib/db';
import { notifySopSaved } from '@/lib/notifications/sops';

/** Generous for a procedure document, small enough to keep payloads sane. */
export const MAX_SOP_CONTENT = 100_000;
export const MAX_SOP_TITLE = 200;
export const MAX_SOP_CHANGE_NOTE = 300;

export const SOP_CONFLICT_ERROR =
  'This SOP changed since you opened it. Reload to get the latest version.';

export type SaveSopVersionResult =
  | { ok: true; sop: SopRow; version: number }
  | { ok: false; conflict: true; error: string }
  | { ok: false; conflict?: false; status: 400 | 500; error: string };

export async function saveSopVersion(
  db: SupabaseClient,
  input: {
    sop: SopRow;
    title: string;
    content: string;
    baseVersion: number;
    editorEmail: string;
    changeNote: string | null;
    suggestionId?: string | null;
  }
): Promise<SaveSopVersionResult> {
  const { sop, title, content, editorEmail } = input;
  const changeNote = input.changeNote?.trim()
    ? input.changeNote.trim().slice(0, MAX_SOP_CHANGE_NOTE)
    : null;

  if (input.baseVersion !== sop.current_version) {
    return { ok: false, conflict: true, error: SOP_CONFLICT_ERROR };
  }
  if (content === sop.content_md && title === sop.title) {
    return { ok: false, status: 400, error: 'No changes to save' };
  }

  const nextVersion = sop.current_version + 1;
  const { error: versionError } = await db.from('sop_versions').insert({
    sop_id: sop.id,
    version: nextVersion,
    title,
    content_md: content,
    edited_by: editorEmail,
    change_note: changeNote,
    ...(input.suggestionId ? { suggestion_id: input.suggestionId } : {}),
  });
  if (versionError) {
    if (versionError.code === '23505') {
      return { ok: false, conflict: true, error: SOP_CONFLICT_ERROR };
    }
    return { ok: false, status: 500, error: versionError.message };
  }

  const { data, error } = await db
    .from('sops')
    .update({ title, content_md: content, current_version: nextVersion, updated_by: editorEmail })
    .eq('id', sop.id)
    .select('*')
    .single();
  if (error) return { ok: false, status: 500, error: error.message };

  await notifySopSaved(db, {
    sop: data as SopRow,
    editorEmail,
    version: nextVersion,
    created: false,
    changeNote,
  });

  return { ok: true, sop: data as SopRow, version: nextVersion };
}
