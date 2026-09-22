// The files behind a card's `files` answers: where they live, how they are
// stored and read back, and how a card's answers and its rows are kept
// saying the same thing. Server-only, for the storage client; the rules a
// file has to meet are client-safe in lib/boards/files.ts.
//
// The card's answer is the source of truth. A row is *staged* (card_id
// null) from the moment it is uploaded until an answer naming it is saved,
// at which point the card claims it; an id an answer stops naming is a row
// to remove, object and all. Every route that writes a card runs the same
// two steps around its write:
//
//   1. filterFileAnswers  — before: drop ids that name nothing this card may
//                           list (no such row, another board, another card's,
//                           a different field), so nothing false is stored;
//   2. syncCardAttachments — after: claim what the answer now lists and
//                           remove what it no longer does.
//
// A staged row nobody claimed within a day is an abandoned pick, and the
// hourly sweep removes it.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CronJobContext } from '@/lib/cron/jobs';
import type { BoardAttachmentRow, BoardFieldRow, BoardFieldValue } from '@/lib/db';
import { getDb } from '@/lib/db';
import { kindForMime, storagePathFor } from '@/lib/media/attachments';
import {
  attachmentDiff,
  FILE_NAME_MAX,
  fileFieldKeys,
  fileIdsOf,
  MAX_FILE_BYTES,
  MAX_FILES_PER_FIELD,
  MAX_STAGED_PER_BOARD,
  MAX_STAGED_PER_UPLOADER,
} from './files';

export const BOARD_MEDIA_BUCKET = 'board-media';

/** Long enough to open a PDF, short enough that a leaked link dies. */
const SIGNED_URL_TTL_SECONDS = 600;

/** Staged uploads nobody claimed within a day are abandoned picks. */
const STAGED_TTL_MS = 24 * 60 * 60 * 1000;
const SWEEP_BATCH = 50;

/** Object key for an upload: boards/<board id>/<random>.<ext>. The key stays put when a card claims the row. */
export function attachmentStoragePath(boardId: string, fileName: string, mime: string): string {
  return storagePathFor('boards', boardId, fileName, mime);
}

export async function loadAttachment(
  db: SupabaseClient,
  id: string
): Promise<BoardAttachmentRow | null> {
  const { data, error } = await db.from('board_attachments').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as BoardAttachmentRow) ?? null;
}

/** A card's files, in upload order. */
export async function loadCardAttachments(
  db: SupabaseClient,
  cardId: string
): Promise<BoardAttachmentRow[]> {
  const { data, error } = await db
    .from('board_attachments')
    .select('*')
    .eq('card_id', cardId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BoardAttachmentRow[];
}

/** A short-lived signed URL for one file; `download` names the file the browser saves. */
export async function signAttachment(
  db: SupabaseClient,
  row: BoardAttachmentRow,
  download: boolean
): Promise<{ url: string; expiresIn: number }> {
  const { data, error } = await db.storage
    .from(BOARD_MEDIA_BUCKET)
    .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS, {
      download: download ? row.file_name : undefined,
    });
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Could not sign that file');
  return { url: data.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS };
}

export type UploadProblem = { status: number; error: string };

export interface UploadInput {
  boardId: string;
  /** The `files` field this answers; checked by the caller against the board's fields. */
  fieldKey: string;
  file: File;
  /** Session email, or 'form' for a public submission. */
  uploadedBy: string;
  /** How the staging cap is counted: by who uploaded it, or by the board. */
  cap: 'uploader' | 'board';
}

/**
 * Put one file in the bucket and record its row, staged. Size, type, and
 * the staging cap are all enforced here, server-side, so the two upload
 * routes (staff and form) cannot disagree about what is acceptable.
 */
export async function storeAttachment(
  db: SupabaseClient,
  input: UploadInput
): Promise<BoardAttachmentRow | UploadProblem> {
  const { file } = input;
  const kind = kindForMime(file.type);
  if (!kind) return { status: 415, error: `Unsupported file type: ${file.type || 'unknown'}` };
  if (file.size === 0) return { status: 400, error: 'That file is empty' };
  if (file.size > MAX_FILE_BYTES) {
    return {
      status: 413,
      error: `That file is ${Math.round(file.size / 1_048_576)} MB; the limit is ${Math.round(MAX_FILE_BYTES / 1_048_576)} MB`,
    };
  }

  // Staged rows have no answer to cap against yet (the claim enforces the
  // per-field cap); cap the person, or the board for a public form, so an
  // abandoned picker cannot pile up 50 MB objects faster than the sweep
  // clears them.
  const staged = db
    .from('board_attachments')
    .select('id', { count: 'exact', head: true })
    .is('card_id', null);
  const { count, error: countError } =
    input.cap === 'uploader'
      ? await staged.eq('uploaded_by', input.uploadedBy)
      : await staged.eq('board_id', input.boardId);
  if (countError) return { status: 500, error: countError.message };
  const limit = input.cap === 'uploader' ? MAX_STAGED_PER_UPLOADER : MAX_STAGED_PER_BOARD;
  if ((count ?? 0) >= limit) {
    return { status: 409, error: 'Too many files waiting to be saved. Save or remove some first.' };
  }

  const fileName = (file.name || `${kind}.bin`).slice(0, FILE_NAME_MAX);
  const storagePath = attachmentStoragePath(input.boardId, fileName, file.type);

  const { error: uploadError } = await db.storage
    .from(BOARD_MEDIA_BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    console.error('[board-media] upload failed:', uploadError.message);
    return { status: 502, error: `Upload failed: ${uploadError.message}` };
  }

  const { data, error } = await db
    .from('board_attachments')
    .insert({
      board_id: input.boardId,
      card_id: null,
      field_key: input.fieldKey,
      storage_path: storagePath,
      file_name: fileName,
      mime_type: file.type,
      size_bytes: file.size,
      kind,
      uploaded_by: input.uploadedBy,
    })
    .select('*')
    .single();
  if (error) {
    // Don't leave an orphan object behind when the row fails.
    await db.storage.from(BOARD_MEDIA_BUCKET).remove([storagePath]);
    return { status: 500, error: error.message };
  }
  return data as BoardAttachmentRow;
}

/**
 * Objects first, rows second, so a failure never strands an unreachable
 * object with no row pointing at it. Best effort on the object: a leftover
 * is a wasted kilobyte, not a broken card.
 */
export async function removeAttachments(
  db: SupabaseClient,
  rows: Pick<BoardAttachmentRow, 'id' | 'storage_path'>[]
): Promise<void> {
  if (rows.length === 0) return;
  const { error: storageError } = await db.storage
    .from(BOARD_MEDIA_BUCKET)
    .remove(rows.map((row) => row.storage_path));
  if (storageError) {
    console.error('[board-media] object remove failed:', storageError.message);
    return;
  }
  const { error } = await db
    .from('board_attachments')
    .delete()
    .in(
      'id',
      rows.map((row) => row.id)
    );
  if (error) console.error('[board-media] row delete failed:', error.message);
}

/**
 * A card's answers with every files id it may not list dropped: an id that
 * names no row, a row on another board, one another card already claimed,
 * or one uploaded for a different field. `cardId` is null for a card that
 * does not exist yet. A field left with no ids loses its key, the way
 * normalizeProperties clears an unusable answer.
 */
export async function filterFileAnswers(
  db: SupabaseClient,
  boardId: string,
  cardId: string | null,
  fields: Pick<BoardFieldRow, 'key' | 'kind'>[],
  properties: Record<string, BoardFieldValue>
): Promise<Record<string, BoardFieldValue>> {
  const keys = fileFieldKeys(fields).filter((key) => properties[key] !== undefined);
  if (keys.length === 0) return properties;

  const ids = keys.flatMap((key) => fileIdsOf(properties[key]));
  const { data, error } =
    ids.length === 0
      ? { data: [], error: null }
      : await db
          .from('board_attachments')
          .select('id, card_id, field_key')
          .eq('board_id', boardId)
          .in('id', ids);
  if (error) throw new Error(error.message);
  const rows = new Map(
    ((data ?? []) as Pick<BoardAttachmentRow, 'id' | 'card_id' | 'field_key'>[]).map((row) => [
      row.id,
      row,
    ])
  );

  const next = { ...properties };
  for (const key of keys) {
    const kept = fileIdsOf(next[key])
      .filter((id) => {
        const row = rows.get(id);
        return (
          row !== undefined &&
          row.field_key === key &&
          (row.card_id === null || (cardId !== null && row.card_id === cardId))
        );
      })
      .slice(0, MAX_FILES_PER_FIELD);
    if (kept.length > 0) next[key] = kept;
    else delete next[key];
  }
  return next;
}

/**
 * After a card is written: the rows its answers now list are its (claimed,
 * if they were staged), and the rows they no longer list are gone. Runs
 * after the card row is saved, so a claim can never point at a card that
 * failed to exist.
 */
export async function syncCardAttachments(
  db: SupabaseClient,
  cardId: string,
  fields: Pick<BoardFieldRow, 'key' | 'kind'>[],
  before: Record<string, BoardFieldValue>,
  after: Record<string, BoardFieldValue>
): Promise<void> {
  const diff = attachmentDiff(fields, before, after);

  if (diff.added.length > 0) {
    const { error } = await db
      .from('board_attachments')
      .update({ card_id: cardId })
      .in('id', diff.added)
      .is('card_id', null);
    if (error) console.error('[board-media] claim failed:', error.message);
  }

  if (diff.removed.length > 0) {
    const { data, error } = await db
      .from('board_attachments')
      .select('id, storage_path')
      .eq('card_id', cardId)
      .in('id', diff.removed);
    if (error) {
      console.error('[board-media] release lookup failed:', error.message);
      return;
    }
    await removeAttachments(db, (data ?? []) as Pick<BoardAttachmentRow, 'id' | 'storage_path'>[]);
  }
}

/** Before a card is deleted: its objects go with it (the rows cascade, the bucket does not). */
export async function deleteCardAttachments(db: SupabaseClient, cardId: string): Promise<void> {
  const { data, error } = await db
    .from('board_attachments')
    .select('id, storage_path')
    .eq('card_id', cardId);
  if (error) {
    console.error('[board-media] card attachments lookup failed:', error.message);
    return;
  }
  await removeAttachments(db, (data ?? []) as Pick<BoardAttachmentRow, 'id' | 'storage_path'>[]);
}

/** Before a board is deleted: every object on it, claimed or staged. */
export async function deleteBoardAttachments(db: SupabaseClient, boardId: string): Promise<void> {
  const { data, error } = await db
    .from('board_attachments')
    .select('id, storage_path')
    .eq('board_id', boardId);
  if (error) {
    console.error('[board-media] board attachments lookup failed:', error.message);
    return;
  }
  await removeAttachments(db, (data ?? []) as Pick<BoardAttachmentRow, 'id' | 'storage_path'>[]);
}

export interface StagedSweepSummary {
  removed: number;
  dryRun: boolean;
  skipped?: string;
}

/**
 * The hourly sweep of staged rows nobody claimed within a day: abandoned
 * pickers, forms closed half-filled. A batch a tick, so one tick after a
 * long outage cannot spend its whole budget here.
 */
export async function sweepStagedAttachments(ctx: CronJobContext): Promise<StagedSweepSummary> {
  const db = getDb();
  if (!db) return { removed: 0, dryRun: ctx.dryRun, skipped: 'no-db' };

  const cutoff = new Date(Date.now() - STAGED_TTL_MS).toISOString();
  const { data, error } = await db
    .from('board_attachments')
    .select('id, storage_path')
    .is('card_id', null)
    .lt('created_at', cutoff)
    .limit(SWEEP_BATCH);
  if (error) {
    console.error('[board-media] staged sweep query failed:', error.message);
    return { removed: 0, dryRun: ctx.dryRun, skipped: error.message };
  }

  const stale = (data ?? []) as Pick<BoardAttachmentRow, 'id' | 'storage_path'>[];
  if (ctx.dryRun || stale.length === 0) return { removed: stale.length, dryRun: ctx.dryRun };
  await removeAttachments(db, stale);
  return { removed: stale.length, dryRun: false };
}
