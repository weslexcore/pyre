// The rules a file has to meet to answer a board's `files` field, and the
// shape of an answer. Client-safe: the drawer, the public form island, and
// the upload routes all read from here, so nothing in it may touch storage
// (that half is lib/boards/card-media.ts).
//
// A `files` answer is an array of board_attachments ids, in the order the
// files were added. The ids are all the card stores; names, sizes, and
// bytes live on the rows, which the API hands back beside the card.

import type { BoardAttachmentRow, BoardFieldRow } from '@/lib/db';
import { BOARD_LIMITS } from './types';

export {
  ACCEPT_ATTRIBUTE,
  checkFile,
  downscaleImage,
  formatBytes,
  kindForMime,
  MAX_FILE_BYTES,
} from '@/lib/media/attachments';

/** How many files one answer may hold. */
export const MAX_FILES_PER_FIELD = BOARD_LIMITS.filesPerField;

/**
 * How many unclaimed staged uploads one signed-in person may hold at once,
 * and how many a public form may leave on one board. Without a ceiling the
 * upload route is an unbounded 50 MB firehose; the hourly sweep bounds how
 * long orphans live, not how fast they pile up.
 */
export const MAX_STAGED_PER_UPLOADER = 24;
export const MAX_STAGED_PER_BOARD = 200;

/** Original names come from phones and can be anything; keep them sane. */
export const FILE_NAME_MAX = 200;

/** What a public form may upload in ten minutes from one address. */
export const UPLOAD_RATE = { limit: 30, windowSeconds: 600 } as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAttachmentId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * A raw `files` answer as it is stored: the ids that look like ids, each
 * once, lowercased, capped. Whether they name real rows on this board is the
 * route's question (card-media.ts filterFileAnswers), not this one's.
 */
export function normalizeFileIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = [...new Set(raw.filter(isAttachmentId).map((id) => id.toLowerCase()))].slice(
    0,
    MAX_FILES_PER_FIELD
  );
  return ids.length > 0 ? ids : null;
}

/** The ids a stored `files` answer holds; [] for anything else. */
export function fileIdsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isAttachmentId) : [];
}

/** The keys of a board's `files` fields, archived ones included: an archived field still holds its answers. */
export function fileFieldKeys(fields: Pick<BoardFieldRow, 'key' | 'kind'>[]): string[] {
  return fields.filter((field) => field.kind === 'files').map((field) => field.key);
}

/**
 * What a card's files answers name before and after a write, by field:
 * the ids the write adds (to be claimed), the ids it drops (to be removed),
 * and every id it ends up listing. Pure, so the routes can be tested
 * without a bucket.
 */
export function attachmentDiff(
  fields: Pick<BoardFieldRow, 'key' | 'kind'>[],
  before: Record<string, unknown>,
  after: Record<string, unknown>
): { listed: string[]; added: string[]; removed: string[] } {
  const was = new Set<string>();
  const now = new Set<string>();
  for (const key of fileFieldKeys(fields)) {
    for (const id of fileIdsOf(before[key])) was.add(id);
    for (const id of fileIdsOf(after[key])) now.add(id);
  }
  return {
    listed: [...now],
    added: [...now].filter((id) => !was.has(id)),
    removed: [...was].filter((id) => !now.has(id)),
  };
}

/** "1 file", "3 files". */
export function formatFileCount(count: number): string {
  return `${count} ${count === 1 ? 'file' : 'files'}`;
}

/** What the islands know about a file: the row without its object key. */
export type AttachmentSummary = Pick<
  BoardAttachmentRow,
  'id' | 'card_id' | 'field_key' | 'file_name' | 'mime_type' | 'size_bytes' | 'kind'
>;

export function summaryOf(row: BoardAttachmentRow): AttachmentSummary {
  return {
    id: row.id,
    card_id: row.card_id,
    field_key: row.field_key,
    file_name: row.file_name,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    kind: row.kind,
  };
}

/** Where a signed-in viewer reads a file back: a redirect to a fresh signed URL. */
export function adminAttachmentHref(id: string, download = false): string {
  return `/api/admin/board-media?id=${encodeURIComponent(id)}${download ? '&download=1' : ''}`;
}

/** Where a form uploads (POST) and un-picks (DELETE) a file before sending. */
export function formMediaHref(slug: string): string {
  return `/api/forms/${slug}/media`;
}
