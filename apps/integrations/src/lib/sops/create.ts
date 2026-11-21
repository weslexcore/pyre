// Creating an SOP, wherever the request came from: the library's New SOP form
// (POST /api/admin/sops) and an admin approving an agent's suggested new
// document (lib/suggestions/kinds/sop-create.ts). Both insert the document,
// its v1 history row, and the section it is filed under, then tell whoever
// follows the library. Server-only; the callers check the inputs and that the
// actor is an admin.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SopRow } from '@/lib/db';
import { isUniqueViolation } from '@/lib/http/json';
import { notifySopSaved } from '@/lib/notifications/sops';
import type { SopRole } from './levels';

/** The longest section (category) name the library takes. */
export const MAX_SOP_CATEGORY = 60;
/** Where a document goes when nobody names a section. */
export const DEFAULT_SOP_CATEGORY = 'General';

export interface NewSop {
  slug: string;
  title: string;
  content: string;
  category: string;
  viewRoles: SopRole[];
  editRoles: SopRole[];
  viewEmails: string[];
  editEmails: string[];
  sortOrder: number;
  /** Who creates it: the signed-in admin, never a value from a request body. */
  creatorEmail: string;
  /** The v1 history row's note. */
  changeNote?: string;
  /** The approved suggestion it came from, stamped on v1 (unique: a retry finds it). */
  suggestionId?: string | null;
}

export type CreateSopResult =
  | { ok: true; sop: SopRow }
  | { ok: false; status: 409 | 500; error: string };

/**
 * Give `name` a row in `sop_categories` if it doesn't have one, placed last.
 * Filing a document under a section that was only ever implied by other
 * documents is what makes that section real and reorderable; without this a
 * category typed into the create form stays unranked and pinned to the bottom.
 * Best-effort: a failure here doesn't invalidate the document itself.
 */
export async function ensureCategory(db: SupabaseClient, name: string): Promise<void> {
  const { data: existing } = await db
    .from('sop_categories')
    .select('name')
    .eq('name', name)
    .maybeSingle();
  if (existing) return;

  const { data: last } = await db
    .from('sop_categories')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  await db
    .from('sop_categories')
    .insert({ name, sort_order: last ? (last.sort_order as number) + 1 : 0 });
}

export async function createSop(db: SupabaseClient, input: NewSop): Promise<CreateSopResult> {
  const { data, error } = await db
    .from('sops')
    .insert({
      slug: input.slug,
      title: input.title,
      content_md: input.content,
      category: input.category,
      view_roles: input.viewRoles,
      edit_roles: input.editRoles,
      view_emails: input.viewEmails,
      edit_emails: input.editEmails,
      sort_order: input.sortOrder,
      created_by: input.creatorEmail,
      updated_by: input.creatorEmail,
    })
    .select('*')
    .single();
  if (error) {
    return isUniqueViolation(error)
      ? { ok: false, status: 409, error: `An SOP with slug "${input.slug}" exists` }
      : { ok: false, status: 500, error: error.message };
  }
  const sop = data as SopRow;

  const { error: versionError } = await db.from('sop_versions').insert({
    sop_id: sop.id,
    version: 1,
    title: input.title,
    content_md: input.content,
    edited_by: input.creatorEmail,
    change_note: input.changeNote ?? 'Created',
    ...(input.suggestionId ? { suggestion_id: input.suggestionId } : {}),
  });
  if (versionError) return { ok: false, status: 500, error: versionError.message };

  await ensureCategory(db, input.category);
  await notifySopSaved(db, { sop, editorEmail: input.creatorEmail, version: 1, created: true });
  return { ok: true, sop };
}
