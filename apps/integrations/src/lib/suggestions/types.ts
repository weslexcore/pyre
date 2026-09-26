// What an agent suggestion is, as both the server and the review UI read it:
// the kinds of action an agent may propose, the shape of each kind's payload,
// and how to describe one in a line. Pure and client-bundle-safe; the
// server-side checks against live data (does the board exist, has the SOP
// moved on) are each kind's handler in ./kinds.
//
// A payload is what the admin edits before approving, so its shape is the
// same one the editors hold and the agent sends: camelCase, like the admin
// API bodies, so the board parsers can read a card payload directly.
//
// Adding a kind: a value in the migration's check, an entry in
// SUGGESTION_KINDS and PAYLOAD_PARSERS here, a handler in ./kinds, and an
// editor in components/admin/suggestions/editors. The Record types make each
// of those a type error until it exists.

import type {
  AgentSuggestionKind,
  AgentSuggestionRow,
  AgentSuggestionSourceType,
  AgentSuggestionStatus,
} from '@/lib/db';

export type SuggestionKind = AgentSuggestionKind;
export type SuggestionStatus = AgentSuggestionStatus;
export type SuggestionSourceType = AgentSuggestionSourceType;

export const SUGGESTION_KINDS: readonly SuggestionKind[] = [
  'board_card.create',
  'board_card.comment',
  'sop.edit',
];

export const SUGGESTION_SOURCE_TYPES: readonly SuggestionSourceType[] = ['shift_note'];

export function isSuggestionKind(value: unknown): value is SuggestionKind {
  return typeof value === 'string' && (SUGGESTION_KINDS as readonly string[]).includes(value);
}

export function isSuggestionSourceType(value: unknown): value is SuggestionSourceType {
  return (
    typeof value === 'string' && (SUGGESTION_SOURCE_TYPES as readonly string[]).includes(value)
  );
}

export const KIND_LABELS: Record<SuggestionKind, string> = {
  'board_card.create': 'New task',
  'board_card.comment': 'Comment on task',
  'sop.edit': 'SOP edit',
};

export const SOURCE_LABELS: Record<SuggestionSourceType, string> = {
  shift_note: 'Shift note',
};

/** At most this many suggestions from one run. */
export const MAX_SUGGESTIONS_PER_RUN = 8;
export const MAX_RATIONALE = 2000;
export const MAX_DECISION_NOTE = 1000;

// Mirrors of the limits the apply paths enforce (BOARD_LIMITS, the SOP
// route), repeated here only so the editors can say so before the server does.
export const SUGGESTION_LIMITS = {
  title: 200,
  notes: 10_000,
  comment: 4000,
  sopTitle: 200,
  sopContent: 100_000,
  changeNote: 300,
  hunks: 20,
} as const;

/** A new card on a board. */
export interface CardCreatePayload {
  /** Board slug. */
  board: string;
  /** A column key on that board; null for its first open column. */
  columnKey: string | null;
  title: string;
  notesMd: string;
  /** YYYY-MM-DD, or null. */
  dueDate: string | null;
  /** Answers to the board's own fields, keyed by field key. */
  properties: Record<string, unknown>;
}

/** A comment on a card that already covers the work. */
export interface CardCommentPayload {
  cardId: string;
  note: string;
}

/** One exact find-and-replace in an SOP, as the agent proposed it. */
export interface SopHunk {
  find: string;
  replace: string;
}

/** A new version of an SOP. */
export interface SopEditPayload {
  sopId: string;
  slug: string;
  /** The version the edit was made against; approving it on a newer one is a conflict. */
  baseVersion: number;
  title: string;
  /** The whole proposed document — what the admin edits and what gets saved. */
  contentMd: string;
  changeNote: string;
  /**
   * The agent's hunks, kept so the edit can be replayed on a newer version
   * when the SOP changes before anyone approves (./sop-edit rebaseSopEdit).
   */
  edits: SopHunk[];
}

export interface PayloadByKind {
  'board_card.create': CardCreatePayload;
  'board_card.comment': CardCommentPayload;
  'sop.edit': SopEditPayload;
}

export type SuggestionPayload = PayloadByKind[SuggestionKind];

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function asObject(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function fail<T>(error: string): ParseResult<T> {
  return { ok: false, error };
}

function parseCardCreatePayload(raw: unknown): ParseResult<CardCreatePayload> {
  const o = asObject(raw);
  if (!o) return fail('payload must be an object');
  const board = str(o.board);
  if (!board) return fail('board is required (a board slug)');
  const title = str(o.title);
  if (!title || title.length > SUGGESTION_LIMITS.title) {
    return fail(`title must be 1–${SUGGESTION_LIMITS.title} characters`);
  }
  const notesMd = typeof o.notesMd === 'string' ? o.notesMd.trim() : '';
  if (notesMd.length > SUGGESTION_LIMITS.notes) {
    return fail(`notesMd must be ${SUGGESTION_LIMITS.notes} characters or fewer`);
  }
  const columnKey = str(o.columnKey) || null;
  let dueDate: string | null = null;
  if (o.dueDate !== undefined && o.dueDate !== null && o.dueDate !== '') {
    if (typeof o.dueDate !== 'string' || !YMD_RE.test(o.dueDate)) {
      return fail('dueDate must be a YYYY-MM-DD date');
    }
    dueDate = o.dueDate;
  }
  const properties = asObject(o.properties ?? {});
  if (!properties) return fail('properties must be an object keyed by field key');
  return { ok: true, value: { board, columnKey, title, notesMd, dueDate, properties } };
}

function parseCardCommentPayload(raw: unknown): ParseResult<CardCommentPayload> {
  const o = asObject(raw);
  if (!o) return fail('payload must be an object');
  if (!isUuid(o.cardId)) return fail('cardId must be the UUID of an existing card');
  const note = str(o.note);
  if (!note || note.length > SUGGESTION_LIMITS.comment) {
    return fail(`note must be 1–${SUGGESTION_LIMITS.comment} characters`);
  }
  return { ok: true, value: { cardId: o.cardId, note } };
}

function parseHunks(raw: unknown): ParseResult<SopHunk[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return fail('edits must be a list of { find, replace }');
  if (raw.length > SUGGESTION_LIMITS.hunks) {
    return fail(`at most ${SUGGESTION_LIMITS.hunks} edits per SOP`);
  }
  const hunks: SopHunk[] = [];
  for (const [i, entry] of raw.entries()) {
    const o = asObject(entry);
    if (!o || typeof o.find !== 'string' || typeof o.replace !== 'string') {
      return fail(`edits[${i}] must be { find, replace } text`);
    }
    if (!o.find) return fail(`edits[${i}].find must not be empty`);
    hunks.push({ find: o.find, replace: o.replace });
  }
  return { ok: true, value: hunks };
}

function parseSopEditPayload(raw: unknown): ParseResult<SopEditPayload> {
  const o = asObject(raw);
  if (!o) return fail('payload must be an object');
  if (!isUuid(o.sopId)) return fail('sopId must be the UUID of an SOP');
  const slug = str(o.slug);
  if (!slug) return fail('slug is required');
  if (typeof o.baseVersion !== 'number' || !Number.isInteger(o.baseVersion) || o.baseVersion < 1) {
    return fail('baseVersion must be the SOP version the edit was made against');
  }
  const title = str(o.title);
  if (!title || title.length > SUGGESTION_LIMITS.sopTitle) {
    return fail(`title must be 1–${SUGGESTION_LIMITS.sopTitle} characters`);
  }
  if (typeof o.contentMd !== 'string' || o.contentMd.length > SUGGESTION_LIMITS.sopContent) {
    return fail(`contentMd must be text of at most ${SUGGESTION_LIMITS.sopContent} characters`);
  }
  const changeNote = str(o.changeNote).slice(0, SUGGESTION_LIMITS.changeNote);
  const edits = parseHunks(o.edits);
  if (!edits.ok) return edits;
  return {
    ok: true,
    value: {
      sopId: o.sopId,
      slug,
      baseVersion: o.baseVersion,
      title,
      contentMd: o.contentMd,
      changeNote,
      edits: edits.value,
    },
  };
}

/** Shape checks per kind; the live-data checks are each kind's validate() in ./kinds. */
export const PAYLOAD_PARSERS: {
  [K in SuggestionKind]: (raw: unknown) => ParseResult<PayloadByKind[K]>;
} = {
  'board_card.create': parseCardCreatePayload,
  'board_card.comment': parseCardCommentPayload,
  'sop.edit': parseSopEditPayload,
};

export function parsePayload<K extends SuggestionKind>(
  kind: K,
  raw: unknown
): ParseResult<PayloadByKind[K]> {
  return PAYLOAD_PARSERS[kind](raw);
}

/** The payload an approval would apply now: the admin's edit, else the original. */
export function currentPayload(
  row: Pick<AgentSuggestionRow, 'payload' | 'edited_payload'>
): Record<string, unknown> {
  return row.edited_payload ?? row.payload;
}

/** One line for the inbox, the notification, and the note's history. */
export function describeSuggestion(kind: SuggestionKind, payload: unknown): string {
  const o = asObject(payload) ?? {};
  switch (kind) {
    case 'board_card.create':
      return `New task: ${str(o.title) || 'untitled'}`;
    case 'board_card.comment':
      return `Comment on a task: ${str(o.note).slice(0, 80)}`;
    case 'sop.edit':
      return `Edit SOP: ${str(o.title) || str(o.slug) || 'untitled'}`;
  }
}

/** Where the review UI and notifications link for a source record. */
export function sourceHref(type: SuggestionSourceType, id: string): string {
  switch (type) {
    case 'shift_note':
      return `/admin/shift-notes#note-${id}`;
  }
}

/** A card's own link: its board, opened on the card. */
export function cardHref(boardSlug: string, cardId: string): string {
  return `/admin/boards/${boardSlug}#card-${cardId}`;
}

/** A decided suggestion's result, resolved server-side for the review UI. */
export interface SuggestionResultLink {
  label: string;
  href: string | null;
}

/** A suggestion as the review UI reads it. */
export type SuggestionView = AgentSuggestionRow & {
  /** The source's text has changed since the agent read it. */
  sourceChanged: boolean;
};

/** A run as the review UI reads it: stale open runs read as failed. */
export interface RunView {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  trigger: 'auto' | 'manual';
  count: number;
  error: string | null;
  createdAt: string;
}

/** A source record as the inbox shows it; null when it has been deleted. */
export interface SourceSummary {
  label: string;
  href: string;
  excerpt: string;
}

/** Links the review UI needs per suggestion: what approving made, and what it acts on. */
export interface SuggestionLinks {
  results: Record<string, SuggestionResultLink>;
  targets: Record<string, SuggestionResultLink>;
}
