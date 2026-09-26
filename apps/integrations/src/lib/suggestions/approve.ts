// What an admin does with a suggestion: approve it (applying the payload they
// settled on, which may be the agent's original or their edit of it), dismiss
// it, or — for an SOP edit whose document moved on — rebase it onto the
// current version. Server-only; the admin route gates who may call these.
//
// Approval order: check the payload against the live data first, then claim
// the suggestion, then apply it, then close it. A failure in apply puts it
// back to pending with the error, and each kind's apply is safe to repeat.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentSuggestionRow } from '@/lib/db';
import { recordSuggestionDecision } from '@/lib/shift-notes/activity';
import { rebaseSopEdit } from '@/lib/sops/sop-edit';
import {
  type Applied,
  type ApplyContext,
  SUGGESTION_KIND_HANDLERS,
  type Validation,
} from './kinds';
import { resolveSuggestionNotice } from './notify';
import { SUGGESTION_SOURCES } from './sources';
import { claim, dismissPending, finishApproved, loadSuggestion, release, saveEdit } from './store';
import {
  currentPayload,
  type ParseResult,
  parsePayload,
  type SopEditPayload,
  type SuggestionKind,
  type SuggestionPayload,
  type SuggestionResultLink,
} from './types';

export type DecisionResult =
  | { ok: true; suggestion: AgentSuggestionRow; result?: SuggestionResultLink }
  | {
      ok: false;
      status: 400 | 404 | 409 | 422 | 500;
      error: string;
      detail?: Record<string, unknown>;
      suggestion?: AgentSuggestionRow;
    };

/** The kind handlers, called without their per-kind payload types. */
interface AnyHandler {
  validate(db: SupabaseClient, payload: SuggestionPayload): Promise<Validation<SuggestionPayload>>;
  apply(db: SupabaseClient, payload: SuggestionPayload, context: ApplyContext): Promise<Applied>;
}

function handlerFor(kind: SuggestionKind): AnyHandler {
  return SUGGESTION_KIND_HANDLERS[kind] as unknown as AnyHandler;
}

/** Parse and check a payload for a kind against the live data. */
export async function checkPayload(
  db: SupabaseClient,
  kind: SuggestionKind,
  raw: unknown
): Promise<Validation<SuggestionPayload>> {
  const parsed = parsePayload(kind, raw) as ParseResult<SuggestionPayload>;
  if (!parsed.ok) return { ok: false, status: 422, error: parsed.error };
  return handlerFor(kind).validate(db, parsed.value);
}

function samePayload(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function approveSuggestion(
  db: SupabaseClient,
  id: string,
  input: { payload?: unknown; note?: string | null; by: string }
): Promise<DecisionResult> {
  const row = await loadSuggestion(db, id);
  if (!row) return { ok: false, status: 404, error: 'Suggestion not found' };
  if (row.status !== 'pending') {
    return {
      ok: false,
      status: 409,
      error: `This suggestion is already ${row.status}`,
      suggestion: row,
    };
  }

  const raw = input.payload ?? currentPayload(row);
  const checked = await checkPayload(db, row.kind, raw);
  if (!checked.ok) {
    return {
      ok: false,
      status: checked.status,
      error: checked.error,
      detail: checked.detail,
      suggestion: row,
    };
  }

  const claimed = await claim(db, id);
  if (!claimed) {
    const now = await loadSuggestion(db, id);
    return {
      ok: false,
      status: 409,
      error: 'Someone else just decided this suggestion',
      ...(now ? { suggestion: now } : {}),
    };
  }

  const origin = await SUGGESTION_SOURCES[row.source_type]
    .load(db, row.source_id)
    .catch(() => null);
  let applied: Applied;
  try {
    applied = await handlerFor(row.kind).apply(db, checked.payload, {
      suggestion: claimed,
      actor: input.by,
      origin,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[suggestions] apply ${row.kind} ${id} failed:`, message);
    await release(db, id, message);
    return { ok: false, status: 500, error: message };
  }

  const applyingPayload = checked.payload as unknown as Record<string, unknown>;
  // What the admin sent, kept as their edit when it differs from the agent's
  // original (the normalizing validate() does is not an edit).
  const sent = parsePayload(row.kind, raw) as ParseResult<SuggestionPayload>;
  const edited =
    input.payload !== undefined && sent.ok && !samePayload(sent.value, row.payload)
      ? (sent.value as unknown as Record<string, unknown>)
      : null;
  const finished = await finishApproved(db, id, {
    applied: applyingPayload,
    edited,
    resultType: applied.resultType,
    resultId: applied.resultId,
    by: input.by,
    note: input.note?.trim() ? input.note.trim().slice(0, 1000) : null,
  });

  if (row.source_type === 'shift_note') {
    await recordSuggestionDecision(db, row.source_id, {
      suggestionId: id,
      kind: row.kind,
      action: 'approved',
      by: input.by,
      result: {
        type: applied.resultType,
        id: applied.resultId,
        href: applied.href,
        label: applied.label,
      },
    });
  }
  await resolveSuggestionNotice(db, row.source_type, row.source_id);

  return {
    ok: true,
    suggestion: finished ?? { ...claimed, status: 'approved' },
    result: { label: applied.label, href: applied.href },
  };
}

export async function dismissSuggestion(
  db: SupabaseClient,
  id: string,
  input: { note?: string | null; by: string }
): Promise<DecisionResult> {
  const dismissed = await dismissPending(
    db,
    id,
    input.by,
    input.note?.trim() ? input.note.trim().slice(0, 1000) : null
  );
  if (!dismissed) {
    const row = await loadSuggestion(db, id);
    if (!row) return { ok: false, status: 404, error: 'Suggestion not found' };
    return {
      ok: false,
      status: 409,
      error: `This suggestion is already ${row.status}`,
      suggestion: row,
    };
  }
  if (dismissed.source_type === 'shift_note') {
    await recordSuggestionDecision(db, dismissed.source_id, {
      suggestionId: id,
      kind: dismissed.kind,
      action: 'dismissed',
      by: input.by,
    });
  }
  await resolveSuggestionNotice(db, dismissed.source_type, dismissed.source_id);
  return { ok: true, suggestion: dismissed };
}

/** Save an admin's working copy of a pending suggestion (shape-checked only). */
export async function editSuggestion(
  db: SupabaseClient,
  id: string,
  input: { payload: unknown; by: string }
): Promise<DecisionResult> {
  const row = await loadSuggestion(db, id);
  if (!row) return { ok: false, status: 404, error: 'Suggestion not found' };
  if (row.status !== 'pending') {
    return {
      ok: false,
      status: 409,
      error: `This suggestion is already ${row.status}`,
      suggestion: row,
    };
  }
  const parsed = parsePayload(row.kind, input.payload) as ParseResult<SuggestionPayload>;
  if (!parsed.ok) return { ok: false, status: 422, error: parsed.error };
  const saved = await saveEdit(
    db,
    id,
    parsed.value as unknown as Record<string, unknown>,
    input.by
  );
  if (!saved) return { ok: false, status: 409, error: 'This suggestion was just decided' };
  return { ok: true, suggestion: saved };
}

/**
 * Re-make a suggested SOP edit against the SOP as it is now, by replaying the
 * agent's hunks. Refused when the admin has rewritten the proposal by hand or
 * a hunk no longer matches; the current document comes back so the editor can
 * show it, and the admin can redo the change against it themselves.
 */
export async function rebaseSuggestion(
  db: SupabaseClient,
  id: string,
  by: string
): Promise<DecisionResult> {
  const row = await loadSuggestion(db, id);
  if (!row) return { ok: false, status: 404, error: 'Suggestion not found' };
  if (row.kind !== 'sop.edit') return { ok: false, status: 400, error: 'Only SOP edits rebase' };
  if (row.status !== 'pending') {
    return {
      ok: false,
      status: 409,
      error: `This suggestion is already ${row.status}`,
      suggestion: row,
    };
  }
  const parsed = parsePayload('sop.edit', currentPayload(row));
  if (!parsed.ok) return { ok: false, status: 422, error: parsed.error };
  const payload: SopEditPayload = parsed.value;

  const [{ data: sopData }, { data: baseData }] = await Promise.all([
    db
      .from('sops')
      .select('id, slug, title, content_md, current_version')
      .eq('id', payload.sopId)
      .maybeSingle(),
    db
      .from('sop_versions')
      .select('content_md')
      .eq('sop_id', payload.sopId)
      .eq('version', payload.baseVersion)
      .maybeSingle(),
  ]);
  const sop = sopData as {
    id: string;
    slug: string;
    title: string;
    content_md: string;
    current_version: number;
  } | null;
  if (!sop) return { ok: false, status: 404, error: 'That SOP no longer exists' };
  if (sop.current_version === payload.baseVersion) {
    return { ok: true, suggestion: row };
  }

  const base = (baseData as { content_md: string } | null)?.content_md;
  const rebased = base === undefined ? null : rebaseSopEdit(payload, base, sop.content_md);
  if (rebased === null) {
    return {
      ok: false,
      status: 409,
      error:
        'The SOP changed in a way this edit can’t be replayed onto. Make the change against the current version instead.',
      detail: { currentVersion: sop.current_version, currentContent: sop.content_md },
    };
  }
  return editSuggestion(db, id, {
    payload: { ...payload, baseVersion: sop.current_version, contentMd: rebased },
    by,
  });
}
