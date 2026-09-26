// Turning what the agent sent into suggestions worth storing: each one's kind
// and payload checked the same way an admin's approval will check them, so a
// suggestion that could never be approved is refused while the agent can
// still fix it. SOP edits arrive as find-and-replace hunks and leave here as
// the whole proposed document. Server-only.

import type { SupabaseClient } from '@supabase/supabase-js';
import { applyHunks } from '@/lib/sops/sop-edit';
import { checkPayload } from './approve';
import type { NewSuggestion } from './store';
import {
  isSuggestionKind,
  MAX_RATIONALE,
  MAX_SUGGESTIONS_PER_RUN,
  type SuggestionKind,
} from './types';

export type IntakeResult =
  | { ok: true; suggestions: NewSuggestion[] }
  | { ok: false; status: 400 | 404 | 409 | 422; error: string; index?: number };

function asObject(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

/**
 * The agent names an SOP by slug and describes the change as hunks against
 * the current version; the stored payload is the whole document with the
 * hunks applied, plus the hunks themselves for a later rebase.
 */
async function expandSopEdit(
  db: SupabaseClient,
  raw: Record<string, unknown>
): Promise<
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; status: 404 | 409 | 422; error: string }
> {
  const slug = typeof raw.slug === 'string' ? raw.slug.trim() : '';
  if (!slug) return { ok: false, status: 422, error: 'slug is required' };
  const { data } = await db
    .from('sops')
    .select('id, slug, title, content_md, current_version, archived')
    .eq('slug', slug)
    .maybeSingle();
  const sop = data as {
    id: string;
    slug: string;
    title: string;
    content_md: string;
    current_version: number;
    archived: boolean;
  } | null;
  if (!sop || sop.archived) return { ok: false, status: 422, error: `No active SOP "${slug}"` };
  if (raw.baseVersion !== undefined && raw.baseVersion !== sop.current_version) {
    return {
      ok: false,
      status: 409,
      error: `"${slug}" is at v${sop.current_version}; read it again and redo the edit`,
    };
  }
  const edits = Array.isArray(raw.edits) ? raw.edits : [];
  if (edits.length === 0)
    return { ok: false, status: 422, error: 'edits must list at least one { find, replace }' };
  const hunks = edits.map((e) => asObject(e) ?? {});
  if (!hunks.every((h) => typeof h.find === 'string' && typeof h.replace === 'string')) {
    return { ok: false, status: 422, error: 'each edit must be { find, replace } text' };
  }
  const applied = applyHunks(
    sop.content_md,
    hunks.map((h) => ({ find: h.find as string, replace: h.replace as string }))
  );
  if (!applied.ok) return { ok: false, status: 422, error: applied.error };
  return {
    ok: true,
    payload: {
      sopId: sop.id,
      slug: sop.slug,
      baseVersion: sop.current_version,
      title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : sop.title,
      contentMd: applied.content,
      changeNote: typeof raw.changeNote === 'string' ? raw.changeNote : '',
      edits: hunks,
    },
  };
}

export async function intakeSuggestions(db: SupabaseClient, raw: unknown): Promise<IntakeResult> {
  if (!Array.isArray(raw))
    return { ok: false, status: 400, error: 'suggestions must be a list (it may be empty)' };
  if (raw.length > MAX_SUGGESTIONS_PER_RUN) {
    return {
      ok: false,
      status: 400,
      error: `At most ${MAX_SUGGESTIONS_PER_RUN} suggestions per run`,
    };
  }

  const out: NewSuggestion[] = [];
  for (const [index, entry] of raw.entries()) {
    const item = asObject(entry);
    if (!item) return { ok: false, status: 400, error: 'each suggestion must be an object', index };
    if (!isSuggestionKind(item.kind)) {
      return { ok: false, status: 422, error: `unknown kind ${JSON.stringify(item.kind)}`, index };
    }
    const kind: SuggestionKind = item.kind;
    let payload = asObject(item.payload);
    if (!payload) return { ok: false, status: 422, error: 'payload must be an object', index };

    if (kind === 'sop.edit') {
      const expanded = await expandSopEdit(db, payload);
      if (!expanded.ok) return { ...expanded, index };
      payload = expanded.payload;
    }

    const checked = await checkPayload(db, kind, payload);
    if (!checked.ok) {
      return {
        ok: false,
        status: checked.status === 404 ? 422 : checked.status,
        error: checked.error,
        index,
      };
    }

    const confidence =
      typeof item.confidence === 'number' && item.confidence >= 0 && item.confidence <= 1
        ? item.confidence
        : null;
    out.push({
      kind,
      payload: checked.payload as unknown as Record<string, unknown>,
      rationale:
        typeof item.rationale === 'string' ? item.rationale.trim().slice(0, MAX_RATIONALE) : '',
      confidence,
      target: checked.target ?? null,
    });
  }
  return { ok: true, suggestions: out };
}
