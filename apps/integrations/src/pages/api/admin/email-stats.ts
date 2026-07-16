// Aggregated email-system stats for the admin dashboard (/admin).
// Reads the three durable stores the email engine writes — email_sends,
// email_suppressions, journey_enrollments — via the service-role client, so
// the route itself must stay behind requireAdmin. Read-only.

import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import { JOURNEYS } from '@/lib/email/journeys/registry';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_DAYS = 7;
const MAX_DAYS = 90;
const DEFAULT_DAYS = 14;

// Caps keep the payload bounded; `truncated` flags in the response say when a
// window was too big to aggregate fully (fine for a studio-sized list).
const MAX_SEND_ROWS = 10_000;
const MAX_ENROLLMENT_ROWS = 20_000;
const MAX_SUPPRESSION_ROWS = 20_000;
const RECENT_LIMIT = 25;

type SendStatus = 'sent' | 'skipped' | 'suppressed' | 'failed';

interface StatusCounts {
  sent: number;
  failed: number;
  suppressed: number;
  skipped: number;
}

function emptyCounts(): StatusCounts {
  return { sent: 0, failed: 0, suppressed: 0, skipped: 0 };
}

function dayKey(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD (UTC)
}

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) {
    return new Response(JSON.stringify({ error: 'Supabase not configured' }), {
      status: 503,
      headers: JSON_HEADERS,
    });
  }

  const daysRaw = Number.parseInt(url.searchParams.get('days') ?? '', 10);
  const days = Number.isNaN(daysRaw)
    ? DEFAULT_DAYS
    : Math.min(MAX_DAYS, Math.max(MIN_DAYS, daysRaw));

  const now = Date.now();
  const cutoffIso = new Date(now - days * DAY_MS).toISOString();
  const nowIso = new Date(now).toISOString();

  const [
    sendsRes,
    recentIssuesRes,
    recentSendsRes,
    suppressionsRes,
    recentSuppressionsRes,
    enrollmentsRes,
    upcomingRes,
    recentEnrollmentsRes,
  ] = await Promise.all([
    db
      .from('email_sends')
      .select('sent_at, status, kind, template, journey_id')
      .gte('sent_at', cutoffIso)
      .order('sent_at', { ascending: false })
      .limit(MAX_SEND_ROWS),
    db
      .from('email_sends')
      .select('id, email, template, kind, journey_id, step_id, campaign, status, error, sent_at')
      .in('status', ['failed', 'suppressed'])
      .order('sent_at', { ascending: false })
      .limit(RECENT_LIMIT),
    db
      .from('email_sends')
      .select('id, email, template, kind, journey_id, step_id, campaign, status, error, sent_at')
      .order('sent_at', { ascending: false })
      .limit(RECENT_LIMIT),
    db
      .from('email_suppressions')
      .select('reason, created_at')
      .order('created_at', { ascending: false })
      .limit(MAX_SUPPRESSION_ROWS),
    db
      .from('email_suppressions')
      .select('email, reason, source, created_at')
      .order('created_at', { ascending: false })
      .limit(10),
    db.from('journey_enrollments').select('journey_id, status, next_at').limit(MAX_ENROLLMENT_ROWS),
    db
      .from('journey_enrollments')
      .select('journey_id, email, member_id, step, next_at')
      .eq('status', 'active')
      .not('next_at', 'is', null)
      .order('next_at', { ascending: true })
      .limit(15),
    db
      .from('journey_enrollments')
      .select('journey_id, email, member_id, step, status, exit_reason, enrolled_at')
      .order('enrolled_at', { ascending: false })
      .limit(10),
  ]);

  const firstError =
    sendsRes.error ??
    recentIssuesRes.error ??
    recentSendsRes.error ??
    suppressionsRes.error ??
    recentSuppressionsRes.error ??
    enrollmentsRes.error ??
    upcomingRes.error ??
    recentEnrollmentsRes.error;

  if (firstError) {
    console.error('[EmailStats] Query failed:', firstError.message);
    return new Response(JSON.stringify({ error: 'Query failed' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }

  const sends = sendsRes.data ?? [];
  const suppressions = suppressionsRes.data ?? [];
  const enrollments = enrollmentsRes.data ?? [];

  // --- Sends: totals, daily series (zero-filled), per-template breakdown ---

  const totals = emptyCounts();
  const byDay = new Map<string, StatusCounts>();
  const byTemplate = new Map<string, StatusCounts & { kind: string; journeyId: string | null }>();

  for (let i = 0; i < days; i++) {
    byDay.set(dayKey(new Date(now - i * DAY_MS).toISOString()), emptyCounts());
  }

  for (const row of sends) {
    const status = row.status as SendStatus;
    totals[status] += 1;

    const day = byDay.get(dayKey(row.sent_at));
    if (day) day[status] += 1;

    let template = byTemplate.get(row.template);
    if (!template) {
      template = { ...emptyCounts(), kind: row.kind, journeyId: row.journey_id };
      byTemplate.set(row.template, template);
    }
    template[status] += 1;
  }

  const attempted = totals.sent + totals.failed;
  const daily = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, ...counts }));

  const templates = [...byTemplate.entries()]
    .map(([template, counts]) => ({ template, ...counts }))
    .sort((a, b) => b.sent + b.failed - (a.sent + a.failed));

  // --- Suppressions: all-time by reason + new inside the window ---

  const byReason: Record<string, number> = {};
  const newByReason: Record<string, number> = {};
  let newInWindow = 0;
  for (const row of suppressions) {
    byReason[row.reason] = (byReason[row.reason] ?? 0) + 1;
    if (row.created_at >= cutoffIso) {
      newInWindow += 1;
      newByReason[row.reason] = (newByReason[row.reason] ?? 0) + 1;
    }
  }

  // --- Journeys: enrollment state per journey, seeded from the registry so
  // defined-but-empty journeys still show up ---

  const journeyStats = new Map<
    string,
    {
      active: number;
      completed: number;
      exited: number;
      overdue: number;
      nextDueAt: string | null;
    }
  >();
  for (const journey of JOURNEYS) {
    journeyStats.set(journey.id, {
      active: 0,
      completed: 0,
      exited: 0,
      overdue: 0,
      nextDueAt: null,
    });
  }

  for (const row of enrollments) {
    let stats = journeyStats.get(row.journey_id);
    if (!stats) {
      // Enrollment rows for a journey since removed from the registry.
      stats = { active: 0, completed: 0, exited: 0, overdue: 0, nextDueAt: null };
      journeyStats.set(row.journey_id, stats);
    }
    stats[row.status as 'active' | 'completed' | 'exited'] += 1;
    if (row.status === 'active' && row.next_at) {
      if (row.next_at < nowIso) stats.overdue += 1;
      if (!stats.nextDueAt || row.next_at < stats.nextDueAt) stats.nextDueAt = row.next_at;
    }
  }

  const registry = new Map(JOURNEYS.map((j) => [j.id, j]));
  const journeys = [...journeyStats.entries()].map(([id, stats]) => ({
    id,
    kind: registry.get(id)?.kind ?? null,
    stepCount: registry.get(id)?.steps.length ?? null,
    registered: registry.has(id),
    ...stats,
  }));

  const body = {
    generatedAt: nowIso,
    days,
    totals: {
      ...totals,
      attempted,
      failureRate: attempted > 0 ? totals.failed / attempted : 0,
    },
    daily,
    templates,
    recentIssues: recentIssuesRes.data ?? [],
    recentSends: recentSendsRes.data ?? [],
    suppressions: {
      total: suppressions.length,
      byReason,
      newInWindow,
      newByReason,
      recent: recentSuppressionsRes.data ?? [],
    },
    journeys,
    upcomingSteps: upcomingRes.data ?? [],
    recentEnrollments: recentEnrollmentsRes.data ?? [],
    truncated: {
      sends: sends.length >= MAX_SEND_ROWS,
      suppressions: suppressions.length >= MAX_SUPPRESSION_ROWS,
      enrollments: enrollments.length >= MAX_ENROLLMENT_ROWS,
    },
  };

  return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
};
