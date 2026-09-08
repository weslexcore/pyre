// The Monday special-event conflict check.
//
// Reads the Momence events feed, finds every regular session (Open Hours,
// Social, and anything else) sitting under a special event in the next four
// weeks, records what it found as a review, and emails the admins. It never
// cancels anything: cancelling happens on /admin/session-conflicts once an
// admin has looked at the list and confirmed.
//
// Cadence: the tick is hourly, so this job gates on "it's Monday in ET and
// past SEND_HOUR". The cron-per-week unique index on the review table is what
// makes it once-per-week, and the per-recipient send_key is what makes the
// email once-per-admin — so a tick that runs out of time mid-send is finished
// by the next one, and a Monday with nothing to report writes a `clear` row
// and stays out of everyone's inbox.

import { addDays, utcToEastern, weekStartOf } from '@pyre/schedule-core';
import type { SessionConflictGroup, SessionConflictsProps } from '@/emails/types';
import { listStaff } from '@/lib/auth/access';
import type { CronJobContext } from '@/lib/cron/jobs';
import { getDb, type SessionConflictReviewRow } from '@/lib/db';
import { sendTemplate } from '@/lib/email/send';
import { cancelRouteStatus } from '@/lib/momence/host-api';
import { fetchMomenceEvents } from '@/lib/momence-events';
import { todayEastern } from '@/lib/schedule/sub';
import { findSessionConflicts, uniqueSessions } from './detect';
import { appOrigin, bookingLabel, formatShortDate, formatWhenLabel, typeLabel } from './labels';
import {
  createReview,
  findCronReviewForWeek,
  ReviewStoreError,
  supersedePending,
  UNIQUE_VIOLATION,
} from './store';
import { HORIZON_DAYS, SESSION_CONFLICTS_PAGE } from './types';

/** ET hour from which Monday's check may run. */
const SEND_HOUR = 7;

/** Stop starting new sends with less than this left in the tick's budget. */
const TIME_FLOOR_MS = 5_000;

export interface SessionConflictsSummary {
  weekStart: string;
  reviewId?: string;
  status?: SessionConflictReviewRow['status'];
  /** Special events with at least one session under them. */
  specialEvents: number;
  /** Distinct sessions overlapping a special event. */
  sessions: number;
  /** Of those, the Open Hours / Social ones pre-selected for cancellation. */
  preselected: number;
  sent: number;
  /** Admins whose email was already claimed for this review. */
  duplicates: number;
  failed: string[];
  skipped?: string;
  outOfTime?: boolean;
  /** Dry runs: what the gate would have said, and who would be emailed. */
  gate?: string;
  wouldSend?: string[];
  preview?: Array<{ event: string; sessionIds: number[] }>;
}

/** Everyone with the admin flag and an address — the notice audience. */
async function listAdminEmails(): Promise<string[]> {
  const rows = await listStaff();
  if (!rows) return [];
  return rows.filter((r) => r.is_admin && r.email).map((r) => r.email as string);
}

/** The review as the email describes it. Exported for the tests and the page. */
export function buildEmailProps(
  review: Pick<SessionConflictReviewRow, 'conflicts' | 'horizon_end'>,
  origin: string
): SessionConflictsProps {
  const groups: SessionConflictGroup[] = review.conflicts.map((group) => ({
    eventTitle: group.specialEvent.title,
    whenLabel: formatWhenLabel(group.specialEvent.startsAt, group.specialEvent.endsAt),
    ...(group.specialEvent.location && { location: group.specialEvent.location }),
    ...(group.specialEvent.link && { link: group.specialEvent.link }),
    sessions: group.sessions.map((session) => ({
      title: session.title,
      whenLabel: formatWhenLabel(session.startsAt, session.endsAt),
      typeLabel: typeLabel(session.type),
      bookingLabel: bookingLabel(session),
      preselected: session.preselected,
      ...(session.link && { link: session.link }),
    })),
  }));

  const sessions = uniqueSessions(review.conflicts);
  const cancelSupport = cancelRouteStatus();
  return {
    // horizon_end is an ET calendar date; label it as one, not as a UTC instant.
    horizonLabel: formatShortDate(`${review.horizon_end}T12:00:00-04:00`),
    sessionCount: sessions.length,
    preselectedCount: sessions.filter((s) => s.preselected).length,
    eventCount: review.conflicts.length,
    groups,
    reviewUrl: `${origin}${SESSION_CONFLICTS_PAGE}`,
    ...(cancelSupport === 'unsupported' && { cancelSupported: false }),
  };
}

export async function runSessionConflictCheck(
  ctx: CronJobContext
): Promise<SessionConflictsSummary> {
  const now = new Date();
  const today = todayEastern();
  const weekStart = weekStartOf(today);
  const base: SessionConflictsSummary = {
    weekStart,
    specialEvents: 0,
    sessions: 0,
    preselected: 0,
    sent: 0,
    duplicates: 0,
    failed: [],
  };

  // Monday, after the send hour, in ET. A dry run reports the gate instead
  // of obeying it, so `?job=session-conflicts&dryRun=1` is useful any day.
  const isMonday = new Date(`${today}T00:00:00`).getDay() === 1;
  const { minutes } = utcToEastern(now.toISOString());
  const gate = !isMonday ? 'not-monday' : minutes < SEND_HOUR * 60 ? 'before-send-hour' : null;
  if (gate && !ctx.dryRun) return { ...base, skipped: gate };

  const db = getDb();
  if (!db) return { ...base, skipped: 'db-unavailable' };

  let review = ctx.dryRun ? null : await findCronReviewForWeek(db, weekStart);
  if (review && review.status !== 'pending') {
    return { ...base, reviewId: review.id, status: review.status, skipped: 'already-ran' };
  }

  if (!review) {
    // fetchMomenceEvents throws on an outage; the tick records the error and
    // nothing is written, so the next tick simply tries again.
    const events = await fetchMomenceEvents();
    const conflicts = findSessionConflicts(events, { now });
    const sessions = uniqueSessions(conflicts);
    const counts = {
      specialEvents: conflicts.length,
      sessions: sessions.length,
      preselected: sessions.filter((s) => s.preselected).length,
    };

    if (ctx.dryRun) {
      return {
        ...base,
        ...counts,
        ...(gate && { gate: `would-skip:${gate}` }),
        wouldSend: conflicts.length > 0 ? await listAdminEmails() : [],
        preview: conflicts.map((g) => ({
          event: `${g.specialEvent.title} (${g.specialEvent.startsAt})`,
          sessionIds: g.sessions.map((s) => s.id),
        })),
      };
    }

    // A mid-week manual review is replaced by Monday's fresh look, not left
    // beside it — there is only ever one open review.
    await supersedePending(db);
    try {
      review = await createReview(db, {
        weekStart,
        horizonStart: today,
        horizonEnd: addDays(today, HORIZON_DAYS),
        conflicts,
        source: 'cron',
        createdBy: 'cron',
      });
    } catch (error) {
      // Another tick won the insert race; carry on with its row.
      if (!(error instanceof ReviewStoreError && error.code === UNIQUE_VIOLATION)) throw error;
      review = await findCronReviewForWeek(db, weekStart);
      if (!review) throw error;
      if (review.status !== 'pending') {
        return {
          ...base,
          ...counts,
          reviewId: review.id,
          status: review.status,
          skipped: 'already-ran',
        };
      }
    }
  }

  const reviewSessions = uniqueSessions(review.conflicts);
  const summary: SessionConflictsSummary = {
    ...base,
    reviewId: review.id,
    status: review.status,
    specialEvents: review.conflicts.length,
    sessions: reviewSessions.length,
    preselected: reviewSessions.filter((s) => s.preselected).length,
  };
  if (review.status === 'clear') return summary;

  const props = buildEmailProps(review, appOrigin());
  const admins = await listAdminEmails();
  if (admins.length === 0) return { ...summary, skipped: 'no-admins' };

  for (const email of admins) {
    if (ctx.timeRemainingMs() < TIME_FLOOR_MS) {
      // No cursor needed: the send_key claims already made let the next tick
      // pick up exactly where this one stopped.
      summary.outOfTime = true;
      break;
    }
    // Per-recipient key: a key of just the review would let the first admin
    // claim it and leave everyone else silently skipped as already-sent.
    try {
      const result = await sendTemplate({
        to: email,
        template: 'session-conflicts',
        props,
        kind: 'transactional',
        sendKey: `session-conflicts:${review.id}:${email}`,
      });
      if (result.status === 'sent') summary.sent += 1;
      else if (result.reason === 'already-sent') summary.duplicates += 1;
    } catch (e) {
      console.error(
        `[session-conflicts] send to ${email} failed:`,
        e instanceof Error ? e.message : e
      );
      summary.failed.push(email);
    }
  }

  if (summary.sent > 0) {
    // Best-effort bookkeeping for the page's "emailed N admins" line.
    const { error } = await db
      .from('session_conflict_reviews')
      .update({
        notified_at: now.toISOString(),
        notified_count: (review.notified_count ?? 0) + summary.sent,
      })
      .eq('id', review.id);
    if (error) console.warn('[session-conflicts] notified_at update failed:', error.message);
  }

  return summary;
}
