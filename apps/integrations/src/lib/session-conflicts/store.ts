// Supabase access for session_conflict_reviews. Small on purpose: every
// write is a conditional update on the row's status, so two admins acting on
// the same review — or a "Check now" racing the Monday cron — cannot
// interleave into a state neither of them saw.

import { addDays, utcToEastern, weekStartOf } from '@pyre/schedule-core';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { SessionConflictReviewRow } from '@/lib/db';
import { fetchMomenceEvents } from '@/lib/momence-events';
import { findSessionConflicts, mergeDetection, reviewStatusFor, uniqueSessionIds } from './detect';
import {
  HORIZON_DAYS,
  type Resolution,
  type ReviewSource,
  type ReviewStatus,
  type SessionConflict,
} from './types';

const TABLE = 'session_conflict_reviews';

/** Postgres unique-violation code — the cron-per-week and one-pending indexes. */
export const UNIQUE_VIOLATION = '23505';

export class ReviewStoreError extends Error {
  constructor(
    message: string,
    public readonly code: string | null
  ) {
    super(message);
    this.name = 'ReviewStoreError';
  }
}

const fail = (error: PostgrestError): never => {
  throw new ReviewStoreError(error.message, error.code ?? null);
};

export async function findPendingReview(
  db: SupabaseClient
): Promise<SessionConflictReviewRow | null> {
  const { data, error } = await db.from(TABLE).select('*').eq('status', 'pending').maybeSingle();
  if (error) fail(error);
  return (data as SessionConflictReviewRow | null) ?? null;
}

export async function findCronReviewForWeek(
  db: SupabaseClient,
  weekStart: string
): Promise<SessionConflictReviewRow | null> {
  const { data, error } = await db
    .from(TABLE)
    .select('*')
    .eq('source', 'cron')
    .eq('week_start', weekStart)
    .maybeSingle();
  if (error) fail(error);
  return (data as SessionConflictReviewRow | null) ?? null;
}

export async function findReview(
  db: SupabaseClient,
  id: string
): Promise<SessionConflictReviewRow | null> {
  const { data, error } = await db.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) fail(error);
  return (data as SessionConflictReviewRow | null) ?? null;
}

/** Closed reviews, newest first — the page's history list. */
export async function listReviewHistory(
  db: SupabaseClient,
  limit = 10
): Promise<SessionConflictReviewRow[]> {
  const { data, error } = await db
    .from(TABLE)
    .select('*')
    .neq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) fail(error);
  return (data ?? []) as SessionConflictReviewRow[];
}

/** Most recent time the detector looked, across every review. */
export async function lastCheckedAt(db: SupabaseClient): Promise<string | null> {
  const { data, error } = await db
    .from(TABLE)
    .select('checked_at')
    .order('checked_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) fail(error);
  return (data as { checked_at: string } | null)?.checked_at ?? null;
}

export interface CreateReviewInput {
  weekStart: string;
  horizonStart: string;
  horizonEnd: string;
  conflicts: SessionConflict[];
  source: ReviewSource;
  createdBy: string;
}

/** Insert a review; `clear` when there is nothing in it. Throws ReviewStoreError. */
export async function createReview(
  db: SupabaseClient,
  input: CreateReviewInput
): Promise<SessionConflictReviewRow> {
  const status: ReviewStatus = input.conflicts.length > 0 ? 'pending' : 'clear';
  const { data, error } = await db
    .from(TABLE)
    .insert({
      week_start: input.weekStart,
      horizon_start: input.horizonStart,
      horizon_end: input.horizonEnd,
      status,
      source: input.source,
      conflicts: input.conflicts,
      session_count: uniqueSessionIds(input.conflicts).length,
      resolution: {},
      created_by: input.createdBy,
    })
    .select('*')
    .single();
  if (error) fail(error);
  return data as SessionConflictReviewRow;
}

/** Close any open review without acting on it — a fresh run replaces it. */
export async function supersedePending(db: SupabaseClient): Promise<void> {
  const { error } = await db.from(TABLE).update({ status: 'superseded' }).eq('status', 'pending');
  if (error) fail(error);
}

export interface RefreshOptions {
  now?: Date;
  /** Dashboard email of whoever pressed "Check now". */
  actor: string;
  horizonDays?: number;
}

export interface RefreshResult {
  review: SessionConflictReviewRow;
  /** Distinct sessions the fresh detection found. */
  detected: number;
}

/**
 * "Check now": read Momence again. With a review open, fold the fresh result
 * into it (what the admin already saw is kept, vanished sessions are marked
 * cleared); otherwise open a new manual review — or a `clear` one, which is
 * how the page records that someone looked and found nothing.
 */
export async function refreshReview(
  db: SupabaseClient,
  { now = new Date(), actor, horizonDays }: RefreshOptions
): Promise<RefreshResult> {
  const events = await fetchMomenceEvents();
  const fresh = findSessionConflicts(events, { now, horizonDays });
  const detected = uniqueSessionIds(fresh).length;
  const today = utcToEastern(now.toISOString()).date;

  const pending = await findPendingReview(db);
  if (pending) {
    const merged = mergeDetection(pending.conflicts, pending.resolution, fresh, now, actor);
    const status = reviewStatusFor(merged.conflicts, merged.resolution);
    const { data, error } = await db
      .from(TABLE)
      .update({
        conflicts: merged.conflicts,
        session_count: uniqueSessionIds(merged.conflicts).length,
        resolution: merged.resolution,
        status,
        horizon_end: addDays(today, horizonDays ?? HORIZON_DAYS),
        checked_at: now.toISOString(),
        ...(status === 'resolved' && { resolved_at: now.toISOString(), resolved_by: actor }),
      })
      .eq('id', pending.id)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle();
    if (error) fail(error);
    // Lost a race with another writer; re-read and let the caller show that.
    if (!data) {
      const current = await findReview(db, pending.id);
      return { review: current ?? pending, detected };
    }
    return { review: data as SessionConflictReviewRow, detected };
  }

  const review = await createReview(db, {
    weekStart: weekStartOf(today),
    horizonStart: today,
    horizonEnd: addDays(today, horizonDays ?? HORIZON_DAYS),
    conflicts: fresh,
    source: 'manual',
    createdBy: actor,
  });
  return { review, detected };
}

/**
 * Record outcomes for sessions on an open review, closing it when every
 * session has one. Returns null when the review is not pending any more
 * (already closed, or another admin got there first).
 */
export async function applyResolution(
  db: SupabaseClient,
  reviewId: string,
  entries: Resolution,
  actor: string,
  now = new Date()
): Promise<SessionConflictReviewRow | null> {
  const current = await findReview(db, reviewId);
  if (current?.status !== 'pending') return null;

  const resolution: Resolution = { ...current.resolution, ...entries };
  const status = reviewStatusFor(current.conflicts, resolution);
  const { data, error } = await db
    .from(TABLE)
    .update({
      resolution,
      status,
      ...(status === 'resolved' && { resolved_at: now.toISOString(), resolved_by: actor }),
    })
    .eq('id', reviewId)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();
  if (error) fail(error);
  return (data as SessionConflictReviewRow | null) ?? null;
}
