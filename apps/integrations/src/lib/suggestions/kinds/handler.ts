// The contract every suggestion kind fulfils, so the agent route and the
// approval flow can treat them alike. Server-only.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentSuggestionRow } from '@/lib/db';
import type { SourceRecord } from '../sources';
import type { ParseResult, PayloadByKind, SuggestionKind } from '../types';

/** The live-data verdict on a payload. */
export type Validation<P> =
  | {
      ok: true;
      /** The payload as it will be stored or applied (e.g. normalized fields). */
      payload: P;
      /** The existing record it acts on, if any. */
      target?: { type: 'board_card' | 'sop'; id: string } | null;
    }
  | {
      ok: false;
      /** 404: what it points at is gone. 409: it moved on (a newer SOP). 422: the payload is wrong. */
      status: 404 | 409 | 422;
      error: string;
      detail?: Record<string, unknown>;
    };

/** What approving made, for the suggestion row and the source's history. */
export interface Applied {
  resultType: NonNullable<AgentSuggestionRow['result_type']>;
  resultId: string;
  label: string;
  href: string | null;
}

export interface ApplyContext {
  suggestion: AgentSuggestionRow;
  /** The approving admin's email: the actor on everything applying writes. */
  actor: string;
  /** Where the suggestion came from, for the link back; null if it was deleted. */
  origin: SourceRecord | null;
}

export interface KindHandler<K extends SuggestionKind> {
  parse(raw: unknown): ParseResult<PayloadByKind[K]>;
  validate(db: SupabaseClient, payload: PayloadByKind[K]): Promise<Validation<PayloadByKind[K]>>;
  /**
   * Do it. Safe to call twice for the same suggestion (a retry after a crash
   * finds what the first attempt made). Throws on failure; the approval flow
   * puts the suggestion back to pending with the error.
   */
  apply(db: SupabaseClient, payload: PayloadByKind[K], context: ApplyContext): Promise<Applied>;
}

/** The origin fields board events carry, so a card's trail can link back. */
export function originDetail(context: ApplyContext): Record<string, unknown> {
  return {
    suggestion_id: context.suggestion.id,
    origin: {
      type: context.suggestion.source_type,
      id: context.suggestion.source_id,
      ...(context.origin ? { label: context.origin.label, href: context.origin.href } : {}),
    },
  };
}
