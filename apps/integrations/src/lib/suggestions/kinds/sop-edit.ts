// sop.edit: a new version of an SOP, saved by the approving admin through the
// same path as the document editor (optimistic-locked on the version the edit
// was made against).

import type { SopVersionRow } from '@/lib/db';
import { loadSop } from '@/lib/sops/document';
import { saveSopVersion } from '@/lib/sops/save-version';
import { PAYLOAD_PARSERS } from '../types';
import type { KindHandler } from './handler';

export const sopEdit: KindHandler<'sop.edit'> = {
  parse: PAYLOAD_PARSERS['sop.edit'],

  async validate(db, payload) {
    const { sop, error } = await loadSop(db, { id: payload.sopId });
    if (error) return { ok: false, status: 422, error };
    if (!sop || sop.archived)
      return { ok: false, status: 404, error: `No active SOP ${payload.slug}` };
    if (payload.contentMd === sop.content_md && payload.title === sop.title) {
      return { ok: false, status: 422, error: 'The edit changes nothing' };
    }
    if (payload.baseVersion !== sop.current_version) {
      return {
        ok: false,
        status: 409,
        error: `This SOP is now at v${sop.current_version}; the suggestion was made against v${payload.baseVersion}.`,
        detail: { currentVersion: sop.current_version },
      };
    }
    return {
      ok: true,
      payload: { ...payload, slug: sop.slug },
      target: { type: 'sop', id: sop.id },
    };
  },

  async apply(db, payload, context) {
    const href = `/admin/sops/${payload.slug}`;
    // A retry after a crash finds the version the first attempt saved.
    const { data: existing } = await db
      .from('sop_versions')
      .select('id, version')
      .eq('suggestion_id', context.suggestion.id)
      .maybeSingle();
    if (existing) {
      const v = existing as Pick<SopVersionRow, 'id' | 'version'>;
      return {
        resultType: 'sop_version',
        resultId: v.id,
        label: `${payload.title} v${v.version}`,
        href,
      };
    }

    const { sop, error } = await loadSop(db, { id: payload.sopId });
    if (error) throw new Error(error);
    if (!sop) throw new Error('That SOP no longer exists');

    const from = context.origin ? ` (suggested from ${context.origin.label})` : ' (suggested)';
    const saved = await saveSopVersion(db, {
      sop,
      title: payload.title,
      content: payload.contentMd,
      baseVersion: payload.baseVersion,
      editorEmail: context.actor,
      changeNote: `${payload.changeNote || 'Suggested edit'}${from}`,
      suggestionId: context.suggestion.id,
    });
    if (!saved.ok) throw new Error(saved.error);

    const { data: version } = await db
      .from('sop_versions')
      .select('id')
      .eq('sop_id', sop.id)
      .eq('version', saved.version)
      .maybeSingle();
    return {
      resultType: 'sop_version',
      resultId: (version as { id: string } | null)?.id ?? sop.id,
      label: `${payload.title} v${saved.version}`,
      href,
    };
  },
};
