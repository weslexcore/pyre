// sop.create: a whole new SOP, for knowledge an agent read in a shift note or
// a Pyre Agent chat that belongs in no existing document. Created by the
// approving admin through the same path as the library's New SOP form
// (lib/sops/create) — creating documents is admin-only, so only an admin can
// approve one. Its v1 carries the suggestion, so the History panel links back
// to where it came from and a retried approval finds it instead of making it
// twice.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getAccess } from '@/lib/auth/access';
import type { SopRow } from '@/lib/db';
import { createSop } from '@/lib/sops/create';
import { PAYLOAD_PARSERS } from '../types';
import type { KindHandler } from './handler';

/** Titles compared the way people read them: case, spacing and punctuation aside. */
function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Whether the SOP's first version was saved by approving an sop.create that
 * is still open (pending again after a failed attempt, or mid-approval).
 */
async function madeByOpenSuggestion(db: SupabaseClient, sopId: string): Promise<boolean> {
  const { data: first } = await db
    .from('sop_versions')
    .select('suggestion_id')
    .eq('sop_id', sopId)
    .eq('version', 1)
    .maybeSingle();
  const suggestionId = (first as { suggestion_id: string | null } | null)?.suggestion_id;
  if (!suggestionId) return false;
  const { data: suggestion } = await db
    .from('agent_suggestions')
    .select('kind, status')
    .eq('id', suggestionId)
    .maybeSingle();
  const row = suggestion as { kind: string; status: string } | null;
  return row?.kind === 'sop.create' && (row.status === 'pending' || row.status === 'applying');
}

export const sopCreate: KindHandler<'sop.create'> = {
  parse: PAYLOAD_PARSERS['sop.create'],

  async validate(db, payload) {
    const { data, error } = await db.from('sops').select('id, slug, title, archived');
    if (error) return { ok: false, status: 422, error: error.message };
    const sops = (data ?? []) as Pick<SopRow, 'id' | 'slug' | 'title' | 'archived'>[];
    // Slugs are unique across the whole library, archived documents included.
    const taken = sops.find((sop) => sop.slug === payload.slug);
    if (taken) {
      // Unless an approval of this very suggestion made it and was cut short:
      // the retry goes on to apply(), which finds the document.
      if (await madeByOpenSuggestion(db, taken.id)) return { ok: true, payload, target: null };
      return {
        ok: false,
        status: 422,
        error: `An SOP with slug "${payload.slug}" already exists; pick another slug, or suggest an edit to that SOP instead`,
      };
    }
    const twin = sops.find(
      (sop) => !sop.archived && titleKey(sop.title) === titleKey(payload.title)
    );
    if (twin) {
      return {
        ok: false,
        status: 422,
        error: `"${twin.title}" (${twin.slug}) already covers this; suggest an edit to it (a new section, or new wording) instead of a second document`,
      };
    }
    return { ok: true, payload, target: null };
  },

  async apply(db, payload, context) {
    // A retry after a crash finds the document the first attempt created.
    const { data: existing } = await db
      .from('sop_versions')
      .select('sop_id')
      .eq('suggestion_id', context.suggestion.id)
      .maybeSingle();
    if (existing) {
      const sopId = (existing as { sop_id: string }).sop_id;
      const { data } = await db
        .from('sops')
        .select('id, slug, title')
        .eq('id', sopId)
        .maybeSingle();
      const sop = data as Pick<SopRow, 'id' | 'slug' | 'title'> | null;
      return {
        resultType: 'sop',
        resultId: sopId,
        label: sop?.title ?? payload.title,
        href: `/admin/sops/${sop?.slug ?? payload.slug}`,
      };
    }

    const access = await getAccess(context.actor);
    if (!access?.isAdmin) {
      throw new Error('Only admins create SOPs; ask an admin to approve this');
    }

    const from = context.origin
      ? `Created (suggested from ${context.origin.label})`
      : 'Created (suggested)';
    const created = await createSop(db, {
      slug: payload.slug,
      title: payload.title,
      content: payload.contentMd,
      category: payload.category,
      viewRoles: payload.viewRoles,
      editRoles: payload.editRoles,
      viewEmails: [],
      editEmails: [],
      sortOrder: 0,
      creatorEmail: context.actor,
      changeNote: from,
      suggestionId: context.suggestion.id,
    });
    if (!created.ok) throw new Error(created.error);
    return {
      resultType: 'sop',
      resultId: created.sop.id,
      label: created.sop.title,
      href: `/admin/sops/${created.sop.slug}`,
    };
  },
};
