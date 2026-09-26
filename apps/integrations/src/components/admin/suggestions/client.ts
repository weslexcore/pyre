// The review UI's calls to /api/admin/suggestions, shared by the panel on a
// source record (useSuggestions) and the inbox. Client-bundle-safe.

import type { BoardFieldRow } from '@/lib/db';
import type {
  SuggestionResultLink,
  SuggestionSourceType,
  SuggestionView,
} from '@/lib/suggestions/types';

const ENDPOINT = '/api/admin/suggestions';

/** A failed call, with what the server said (and, for a conflict, what changed). */
export class SuggestionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: Record<string, unknown>,
    readonly suggestion?: SuggestionView
  ) {
    super(message);
  }
}

async function send<T>(method: 'POST' | 'PATCH', body: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & {
    error?: string;
    detail?: Record<string, unknown>;
    suggestion?: SuggestionView;
  };
  if (!res.ok) {
    throw new SuggestionError(
      data.error ?? `HTTP ${res.status}`,
      res.status,
      data.detail,
      data.suggestion
    );
  }
  return data;
}

export interface Decided {
  suggestion: SuggestionView;
  result?: SuggestionResultLink;
}

export function approve(id: string, payload: unknown, note?: string): Promise<Decided> {
  return send('POST', { action: 'approve', id, payload, ...(note ? { note } : {}) });
}

export function dismiss(id: string, note?: string): Promise<Decided> {
  return send('POST', { action: 'dismiss', id, ...(note ? { note } : {}) });
}

export function saveEdit(id: string, payload: unknown): Promise<Decided> {
  return send('PATCH', { id, payload });
}

export function rebase(id: string): Promise<Decided> {
  return send('POST', { action: 'rebase', id });
}

export function requestSuggestions(
  sourceType: SuggestionSourceType,
  sourceId: string
): Promise<{ run: import('@/lib/suggestions/types').RunView }> {
  return send('POST', { action: 'suggest', sourceType, sourceId });
}

/** A board as the card editor needs it: where a card can go and what it can hold. */
export interface BoardOption {
  id: string;
  slug: string;
  name: string;
  card_noun: string;
  /** Open columns, then done ones (for work already finished). */
  columns: { key: string; label: string; kind: 'open' | 'done' }[];
  fields: BoardFieldRow[];
}

let boardsPromise: Promise<BoardOption[]> | null = null;

/** The active boards, fetched once per page. */
export function loadBoardOptions(): Promise<BoardOption[]> {
  boardsPromise ??= fetch(`${ENDPOINT}?context=boards`)
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return ((await res.json()) as { boards: BoardOption[] }).boards;
    })
    .catch((error) => {
      boardsPromise = null;
      throw error;
    });
  return boardsPromise;
}

export interface CurrentSop {
  id: string;
  slug: string;
  title: string;
  content_md: string;
  current_version: number;
}

export async function loadCurrentSop(id: string): Promise<CurrentSop> {
  const res = await fetch(`${ENDPOINT}?context=sop&id=${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { sop: CurrentSop }).sop;
}
