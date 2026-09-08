// The special-event conflict review API behind /admin/session-conflicts.
//
// GET  — the open review (if any), recent closed ones, and whether the host
//        API is known to cancel sessions on this account.
// POST — one of three actions, all admin-only, CSRF-guarded, JSON-only:
//        { action: 'check' }                          re-read Momence now
//        { action: 'cancel', reviewId, sessionIds }   cancel the ticked sessions
//        { action: 'dismiss', reviewId }              mark the rest handled
//
// The actor on every write is the session's email, never the body's.

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireAdmin } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import { cancelRouteStatus } from '@/lib/momence/host-api';
import { cancelSelectedSessions } from '@/lib/session-conflicts/cancel';
import { uniqueSessionIds } from '@/lib/session-conflicts/detect';
import {
  applyResolution,
  findPendingReview,
  findReview,
  lastCheckedAt,
  listReviewHistory,
  refreshReview,
} from '@/lib/session-conflicts/store';
import { HORIZON_DAYS, isHandled, type Resolution } from '@/lib/session-conflicts/types';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** The page's own budget: leave headroom under the function's 60s. */
const TIME_BUDGET_MS = 50_000;
const MAX_SESSION_IDS = 200;

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  try {
    const [pending, history, checkedAt] = await Promise.all([
      findPendingReview(db),
      listReviewHistory(db),
      lastCheckedAt(db),
    ]);
    return json({
      pending,
      history,
      lastCheckedAt: checkedAt,
      cancelSupport: cancelRouteStatus(),
      horizonDays: HORIZON_DAYS,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Read failed' }, 500);
  }
};

function parseSessionIds(raw: unknown): number[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return 'sessionIds must be a non-empty array';
  if (raw.length > MAX_SESSION_IDS) return `sessionIds must hold at most ${MAX_SESSION_IDS} ids`;
  const ids: number[] = [];
  for (const value of raw) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      return 'sessionIds must be positive integers';
    }
    ids.push(value);
  }
  return [...new Set(ids)];
}

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Body must be JSON' }, 400);
  }

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const actor = gate.user.email ?? 'admin';
  const started = Date.now();
  const timeRemainingMs = () => TIME_BUDGET_MS - (Date.now() - started);

  switch (body.action) {
    case 'check': {
      try {
        const { review, detected } = await refreshReview(db, { actor });
        return json({ ok: true, review, detected, cancelSupport: cancelRouteStatus() });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Check failed';
        // A Momence outage is the one failure worth naming for the person
        // pressing the button; everything else is ours.
        const status = /Momence|Events API/.test(message) ? 502 : 500;
        return json({ error: message }, status);
      }
    }

    case 'cancel': {
      const reviewId = typeof body.reviewId === 'string' ? body.reviewId : '';
      if (!reviewId) return json({ error: 'reviewId is required' }, 400);
      const ids = parseSessionIds(body.sessionIds);
      if (typeof ids === 'string') return json({ error: ids }, 400);

      let review: Awaited<ReturnType<typeof findReview>>;
      try {
        review = await findReview(db, reviewId);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Read failed' }, 500);
      }
      if (!review) return json({ error: 'Review not found' }, 404);
      if (review.status !== 'pending') return json({ error: 'This review is already closed' }, 409);

      const known = new Set(uniqueSessionIds(review.conflicts));
      const foreign = ids.filter((id) => !known.has(id));
      if (foreign.length > 0) {
        return json({ error: `Sessions not on this review: ${foreign.join(', ')}` }, 400);
      }

      try {
        const result = await cancelSelectedSessions(db, review, ids, actor, timeRemainingMs);
        if (!result.review) return json({ error: 'This review was closed by someone else' }, 409);
        return json({ ok: true, ...result });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Cancel failed' }, 500);
      }
    }

    case 'dismiss': {
      const reviewId = typeof body.reviewId === 'string' ? body.reviewId : '';
      if (!reviewId) return json({ error: 'reviewId is required' }, 400);

      try {
        const review = await findReview(db, reviewId);
        if (!review) return json({ error: 'Review not found' }, 404);
        if (review.status !== 'pending') {
          return json({ error: 'This review is already closed' }, 409);
        }
        const at = new Date().toISOString();
        const entries: Resolution = {};
        for (const id of uniqueSessionIds(review.conflicts)) {
          if (isHandled(review.resolution[String(id)])) continue;
          entries[String(id)] = { outcome: 'skipped', message: 'Handled manually', at, by: actor };
        }
        const updated = await applyResolution(db, reviewId, entries, actor);
        if (!updated) return json({ error: 'This review was closed by someone else' }, 409);
        console.info(`[session-conflicts] ${actor} dismissed review ${reviewId}`);
        return json({ ok: true, review: updated });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Dismiss failed' }, 500);
      }
    }

    default:
      return json({ error: 'action must be check, cancel, or dismiss' }, 400);
  }
};
