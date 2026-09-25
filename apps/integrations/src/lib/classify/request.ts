// Classify a record's text with Jev (TypeSafe AI's System One model, asked
// directly through AI Gateway by @pyre/signals-core) and read the answers
// back. A route that writes
// text calls scheduleClassification() (./dispatch) after the write, which
// queues a QStash message; the worker route (/api/classify/run) then calls
// runClassification() here. A route that lists records calls
// loadClassifications() for the ones it returns. What a subject is, and
// which signals exist, is @pyre/signals-core's business; see
// src/lib/classify/subjects.ts for the per-subject hooks this app needs.
//
// Nothing here throws, and Jev being unreachable (no AI Gateway key locally,
// see lib/jev.ts) simply turns classification off.

import { createHash, randomUUID } from 'node:crypto';
import type { EvaluationModel } from '@pyre/jev';
import { classifySignals, type SubjectType, sanitizeClassifyText } from '@pyre/signals-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ContentClassificationRow } from '@/lib/db';
import { jevOptions } from '@/lib/jev';
import { CLASSIFICATION_RECORDERS } from './activity';
import { type ClassificationView, toClassificationView } from './view';

/** sha256 of the text as Jev would see it. Exported for tests. */
export function contentHash(text: string): string {
  return createHash('sha256').update(sanitizeClassifyText(text)).digest('hex');
}

export interface ClassifyOptions {
  /** Re-run even when the text has not changed since the last run (an admin's retry). */
  force?: boolean;
  /** The admin who asked for this run, recorded with its answer; absent when a write triggered it. */
  requestedBy?: string;
}

/** What an admin's page shows right after scheduling: a read in progress. */
export function pendingView(now: Date = new Date()): ClassificationView {
  return { state: 'pending', signals: [], requestedAt: now.toISOString(), classifiedAt: null };
}

/**
 * Classify `text` as the current content of one record, now: file the
 * request, ask Jev, store the answer. Runs from the QStash worker
 * (/api/classify/run), or inline in the background where QStash is not
 * configured. Returns the resulting view (state 'failed' when AI Gateway or
 * Jev failed — the worker answers that with a retryable status), or null when
 * classification is off, the answer was superseded, or the bookkeeping itself
 * failed. Never throws.
 */
export async function runClassification(
  db: SupabaseClient,
  subject: SubjectType,
  subjectId: string,
  text: string,
  options: ClassifyOptions & { model?: EvaluationModel } = {}
): Promise<ClassificationView | null> {
  try {
    const jev = jevOptions();
    if (!jev || !sanitizeClassifyText(text)) return null;
    const hash = contentHash(text);

    const { data: existingData } = await db
      .from('content_classifications')
      .select('status, signals, requested_at, classified_at, content_hash, attempts')
      .eq('subject_type', subject)
      .eq('subject_id', subjectId)
      .maybeSingle();
    const existing = existingData as ContentClassificationRow | null;
    const sameText = existing?.content_hash === hash;
    if (!options.force && existing && sameText) {
      const view = toClassificationView(existing);
      if (view.state !== 'failed') return view;
    }

    // A fresh request id on every run, so an older run finishing late can
    // never overwrite this one (its guarded write below matches nothing).
    const requestId = randomUUID();
    const { error: fileError } = await db.from('content_classifications').upsert(
      {
        subject_type: subject,
        subject_id: subjectId,
        status: 'pending',
        signals: [],
        request_id: requestId,
        content_hash: hash,
        attempts: (sameText && existing ? existing.attempts : 0) + 1,
        model: null,
        error: null,
        requested_at: new Date().toISOString(),
        classified_at: null,
      },
      { onConflict: 'subject_type,subject_id' }
    );
    if (fileError) {
      console.error('[classify] could not file request:', fileError.message);
      return null;
    }

    let update: Partial<ContentClassificationRow>;
    try {
      const result = await classifySignals(subject, text, {
        ...jev,
        ...(options.model ? { model: options.model } : {}),
      });
      update = {
        status: 'done',
        signals: result.signals,
        model: result.model,
        classified_at: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[classify] ${subject} ${subjectId}:`, message);
      update = { status: 'failed', error: message.slice(0, 500) };
    }

    const { data: saved } = await db
      .from('content_classifications')
      .update(update)
      .eq('request_id', requestId)
      .select('status, signals, requested_at, classified_at, model')
      .maybeSingle();
    // Nothing saved means a newer run (an edit, a retry) replaced this one,
    // or the record was deleted meanwhile; either way this answer is stale.
    if (!saved) return null;
    const row = saved as ContentClassificationRow;
    // Each answer also lands in the record's history. Failures don't: QStash
    // retries them, and the record's chips already show where the read stands.
    if (row.status === 'done') {
      await CLASSIFICATION_RECORDERS[subject](db, subjectId, {
        signals: row.signals,
        model: row.model,
        ...(options.requestedBy ? { requestedBy: options.requestedBy } : {}),
      });
    }
    return toClassificationView(row);
  } catch (error) {
    console.error(`[classify] ${subject} ${subjectId}: run failed:`, error);
    return null;
  }
}

/**
 * The classifications of `ids`, keyed by subject id. Records never
 * classified are simply absent. Errors read as "none": a page listing
 * records must render without them.
 */
export async function loadClassifications(
  db: SupabaseClient,
  subject: SubjectType,
  ids: readonly string[]
): Promise<Record<string, ClassificationView>> {
  const out: Record<string, ClassificationView> = {};
  if (ids.length === 0) return out;
  const { data, error } = await db
    .from('content_classifications')
    .select('subject_id, status, signals, requested_at, classified_at')
    .eq('subject_type', subject)
    .in('subject_id', [...ids]);
  if (error) {
    console.error('[classify] load failed:', error.message);
    return out;
  }
  const now = Date.now();
  for (const row of (data ?? []) as ContentClassificationRow[]) {
    out[row.subject_id] = toClassificationView(row, now);
  }
  return out;
}
