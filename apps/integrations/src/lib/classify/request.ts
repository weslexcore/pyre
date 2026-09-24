// Classify a record's text with Jev (TypeSafe AI's System One model, served by
// the pyre-agents Eve app) and read the answers back. This is the one entry
// point every feature uses: a route that writes text calls
// scheduleClassification() after the write, and a route that lists records
// calls loadClassifications() for the ones it returns. What a subject is, and
// which signals exist, is @pyre/signals-core's business; see
// src/lib/classify/subjects.ts for the per-subject hooks this app needs.
//
// Nothing here is on a person's critical path. scheduleClassification()
// returns immediately and hands the work to waitUntil, so the response that
// saved the note goes out first; the bookkeeping, the call to pyre-agents,
// and the result write all happen after. If that background work dies with
// the instance, the hourly classify sweep (runClassifySweep) finds the note
// and tries again. Nothing here throws, and a missing agent configuration
// (AGENTS_BASE_URL / EVE_CHANNEL_SECRET) simply turns classification off.

import { createHash, randomUUID } from 'node:crypto';
import { parseSignals, type SubjectType, sanitizeClassifyText } from '@pyre/signals-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { waitUntil } from '@vercel/functions';
import { type ContentClassificationRow, getDb } from '@/lib/db';
import { type ClassificationView, toClassificationView } from './view';

/** Jev answers in well under a second; this only bounds a stuck upstream. */
const CLASSIFY_TIMEOUT_MS = 30_000;

/** Tries per text before the sweep leaves it failed (an admin can still re-run it). */
export const MAX_ATTEMPTS = 3;

interface AgentsConfig {
  url: string;
  headers: Record<string, string>;
}

function agentsConfig(): AgentsConfig | null {
  const baseUrl = import.meta.env.AGENTS_BASE_URL;
  const channelSecret = import.meta.env.EVE_CHANNEL_SECRET;
  if (!baseUrl || !channelSecret) return null;
  // Preview deployments of pyre-agents sit behind Vercel Deployment
  // Protection; the bypass clears the edge only, the secret still authenticates.
  const bypass = import.meta.env.AGENTS_PROTECTION_BYPASS;
  return {
    url: `${baseUrl.replace(/\/$/, '')}/pyre/classify`,
    headers: {
      Authorization: `Bearer ${channelSecret}`,
      'Content-Type': 'application/json',
      ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}),
    },
  };
}

/** sha256 of the text as Jev would see it. Exported for tests. */
export function contentHash(text: string): string {
  return createHash('sha256').update(sanitizeClassifyText(text)).digest('hex');
}

export interface ClassifyOptions {
  /** Re-run even when the text has not changed since the last run (an admin's retry). */
  force?: boolean;
}

/**
 * Classify a record's current text in the background. Returns at once; the
 * caller's response is never held for it. Call it on every write that may
 * have changed the text: unchanged text is skipped in the background.
 */
export function scheduleClassification(
  subject: SubjectType,
  subjectId: string,
  text: string,
  options: ClassifyOptions = {}
): void {
  if (!agentsConfig()) return;
  const db = getDb();
  if (!db) return;
  waitUntil(runClassification(db, subject, subjectId, text, options));
}

/** What an admin's page shows right after scheduling: a read in progress. */
export function pendingView(now: Date = new Date()): ClassificationView {
  return { state: 'pending', signals: [], requestedAt: now.toISOString(), classifiedAt: null };
}

/**
 * Classify `text` as the current content of one record, now: file the
 * request, ask pyre-agents, store the answer. Runs in the background (via
 * scheduleClassification) or from the sweep. Returns the resulting view, or
 * null when classification is off or the bookkeeping itself failed. Never
 * throws.
 */
export async function runClassification(
  db: SupabaseClient,
  subject: SubjectType,
  subjectId: string,
  text: string,
  options: ClassifyOptions & { fetch?: typeof fetch } = {}
): Promise<ClassificationView | null> {
  try {
    const config = agentsConfig();
    if (!config || !sanitizeClassifyText(text)) return null;
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
      const response = await (options.fetch ?? fetch)(config.url, {
        method: 'POST',
        headers: config.headers,
        body: JSON.stringify({ subject, text }),
        signal: AbortSignal.timeout(CLASSIFY_TIMEOUT_MS),
      });
      const body = (await response.json().catch(() => ({}))) as {
        model?: unknown;
        probabilities?: unknown;
        error?: unknown;
      };
      if (!response.ok) {
        throw new Error(
          `pyre-agents HTTP ${response.status}: ${typeof body.error === 'string' ? body.error : 'no detail'}`
        );
      }
      const parsed = parseSignals(body.probabilities, subject);
      if (!parsed.ok) throw new Error(`pyre-agents answer rejected: ${parsed.error}`);
      update = {
        status: 'done',
        signals: parsed.signals,
        model: typeof body.model === 'string' ? body.model.slice(0, 100) : null,
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
      .select('status, signals, requested_at, classified_at')
      .maybeSingle();
    // Nothing saved means a newer run (an edit, a retry) replaced this one,
    // or the record was deleted meanwhile; either way this answer is stale.
    return saved ? toClassificationView(saved as ContentClassificationRow) : null;
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
