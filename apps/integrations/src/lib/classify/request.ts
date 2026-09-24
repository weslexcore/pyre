// Ask the pyre-agents classifier what a record's text contains, and read the
// answers back. This is the one entry point every feature uses: a route that
// writes text calls requestClassification() after the write, and a route
// that lists records calls loadClassifications() for the ones it returns.
// What a subject is, and which signals exist, is @pyre/signals-core's
// business; see src/lib/classify/subjects.ts for the per-subject hooks this
// app needs (where the text lives, who may re-run it).
//
// Classification is best-effort by design: nothing here throws, and a
// missing agent configuration (AGENTS_BASE_URL / EVE_CHANNEL_SECRET) simply
// turns it off. The record's own write never waits on the model — only on
// starting the session, capped at START_TIMEOUT_MS.

import { createHash, randomUUID } from 'node:crypto';
import { buildClassifyMessage, type SubjectType, sanitizeClassifyText } from '@pyre/signals-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ContentClassificationRow } from '@/lib/db';
import { type EveConfig, startEveSession } from '@/lib/schedule/eve-session';
import { type ClassificationView, toClassificationView } from './view';

/** The role and request headers pyre-agents reads (agent/lib/role.ts there). */
const AGENT_HEADER = 'x-pyre-agent';
const CLASSIFY_REQUEST_HEADER = 'x-pyre-classify-request';

/** How long a write waits for the agent to accept the session. */
const START_TIMEOUT_MS = 8_000;

function classifierConfig(requestId: string): EveConfig | null {
  const baseUrl = import.meta.env.AGENTS_BASE_URL;
  const channelSecret = import.meta.env.EVE_CHANNEL_SECRET;
  if (!baseUrl || !channelSecret) return null;
  return {
    baseUrl,
    channelSecret,
    bypassSecret: import.meta.env.AGENTS_PROTECTION_BYPASS,
    headers: { [AGENT_HEADER]: 'classifier', [CLASSIFY_REQUEST_HEADER]: requestId },
  };
}

/** sha256 of the text as the model would see it. Exported for tests. */
export function contentHash(text: string): string {
  return createHash('sha256').update(sanitizeClassifyText(text)).digest('hex');
}

export interface RequestClassificationOptions {
  /** Re-run even when the text has not changed since the last request (an admin's retry). */
  force?: boolean;
}

/**
 * Classify `text` as the current content of one record. Skips the model when
 * the same text is already classified or in flight (unless `force`), so
 * callers can call this on every write without checking what changed.
 * Returns the resulting view, or null when classification is off or the
 * bookkeeping itself failed.
 */
export async function requestClassification(
  db: SupabaseClient,
  subject: SubjectType,
  subjectId: string,
  text: string,
  options: RequestClassificationOptions = {}
): Promise<ClassificationView | null> {
  try {
    if (!sanitizeClassifyText(text)) return null;
    const hash = contentHash(text);

    const requestId = randomUUID();
    const config = classifierConfig(requestId);
    if (!config) return null;

    if (!options.force) {
      const { data: existing } = await db
        .from('content_classifications')
        .select('status, signals, requested_at, classified_at, content_hash')
        .eq('subject_type', subject)
        .eq('subject_id', subjectId)
        .maybeSingle();
      const row = existing as ContentClassificationRow | null;
      if (row && row.content_hash === hash) {
        const view = toClassificationView(row);
        if (view.state !== 'failed') return view;
      }
    }

    // File the request before starting the session, so the agent's save can
    // never arrive ahead of the row it lands on.
    const requestedAt = new Date().toISOString();
    const { data: filed, error: fileError } = await db
      .from('content_classifications')
      .upsert(
        {
          subject_type: subject,
          subject_id: subjectId,
          status: 'pending',
          signals: [],
          request_id: requestId,
          content_hash: hash,
          agent_session_id: null,
          error: null,
          requested_at: requestedAt,
          classified_at: null,
        },
        { onConflict: 'subject_type,subject_id' }
      )
      .select('*')
      .single();
    if (fileError) {
      console.error('[classify] could not file request:', fileError.message);
      return null;
    }

    try {
      const sessionId = await startEveSession(
        config,
        buildClassifyMessage(subject, text),
        AbortSignal.timeout(START_TIMEOUT_MS)
      );
      if (sessionId) {
        await db
          .from('content_classifications')
          .update({ agent_session_id: sessionId })
          .eq('request_id', requestId);
      }
      return toClassificationView(filed as ContentClassificationRow);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[classify] ${subject} ${subjectId}: session failed:`, message);
      const { data: failed } = await db
        .from('content_classifications')
        .update({ status: 'failed', error: message.slice(0, 500) })
        .eq('request_id', requestId)
        .select('*')
        .maybeSingle();
      return failed ? toClassificationView(failed as ContentClassificationRow) : null;
    }
  } catch (error) {
    console.error(`[classify] ${subject} ${subjectId}: request failed:`, error);
    return null;
  }
}

/**
 * The classifications of `ids`, keyed by subject id. Records never
 * classified are simply absent. Errors read as "none" — a page listing
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
