// "Draft schedule" trigger: sync Momence coverage windows first (so the agent
// sees current reality), then start one pyre-agents Eve session per requested
// week. The week view sends a single week; the month view sends every week
// that still has uncovered shifts. Drafts only fill uncovered shifts — the
// agent is instructed to and /api/agent/proposals enforces it. Returns
// immediately with the session ids — the board polls for the resulting
// proposals rather than holding this request open through the agent runs.

import { weekStartOf } from '@pyre/schedule-core';
import type { APIRoute } from 'astro';
import { assertSameOrigin, requireScheduleManage } from '@/lib/auth/admin';
import { actorFromGate } from '@/lib/schedule/change-log';
import { type SyncShiftsSummary, syncShifts } from '@/lib/schedule/sync';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A month view spans at most 6 Mondays; anything more is a client bug. */
const MAX_WEEKS = 6;

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requireScheduleManage(cookies);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const agentsBaseUrl = import.meta.env.AGENTS_BASE_URL;
  const channelSecret = import.meta.env.EVE_CHANNEL_SECRET;
  if (!agentsBaseUrl || !channelSecret) {
    return json({ error: 'Agent not configured (AGENTS_BASE_URL / EVE_CHANNEL_SECRET)' }, 503);
  }

  // Preview/staging deployments of pyre-agents sit behind Vercel Deployment
  // Protection, which 401s at the edge before EVE_CHANNEL_SECRET is ever
  // checked. The bypass secret gets us past that layer only — the channel
  // secret above is still what authenticates us to the agent.
  const agentsBypass = import.meta.env.AGENTS_PROTECTION_BYPASS;

  let body: Record<string, unknown> = {};
  try {
    if (request.headers.get('content-type')?.includes('application/json')) {
      body = (await request.json()) as Record<string, unknown>;
    }
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  // One week (weekStart — the original shape) or several (weekStarts — the
  // month view drafting every week that still has uncovered shifts).
  const rawWeeks: unknown[] = Array.isArray(body.weekStarts)
    ? body.weekStarts
    : body.weekStart !== undefined
      ? [body.weekStart]
      : [];
  const uniqueWeeks = [...new Set(rawWeeks)];
  if (uniqueWeeks.length === 0 || uniqueWeeks.length > MAX_WEEKS) {
    return json({ error: `weekStarts must list 1–${MAX_WEEKS} weeks` }, 400);
  }
  for (const week of uniqueWeeks) {
    if (typeof week !== 'string' || !DATE_RE.test(week) || weekStartOf(week) !== week) {
      return json({ error: 'Each week start must be a Monday as YYYY-MM-DD' }, 400);
    }
  }
  const weekStarts = (uniqueWeeks as string[]).sort();

  // Fresh windows before drafting — a stale board is the agent's worst input.
  let sync: SyncShiftsSummary | { error: string };
  try {
    sync = await syncShifts({ actor: actorFromGate(gate) });
  } catch (error) {
    // Draft anyway on sync failure (Momence hiccups shouldn't block a manual
    // draft of already-synced shifts), but tell the admin.
    sync = { error: error instanceof Error ? error.message : 'Sync failed' };
  }

  const sessions: Array<{ weekStart: string; sessionId: string | null }> = [];
  for (const week of weekStarts) {
    const response = await fetch(`${agentsBaseUrl.replace(/\/$/, '')}/eve/v1/session`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${channelSecret}`,
        'Content-Type': 'application/json',
        ...(agentsBypass ? { 'x-vercel-protection-bypass': agentsBypass } : {}),
      },
      body: JSON.stringify({
        message: `Draft the staffing schedule for the week starting ${week}. Use get_week_context with weekStart "${week}", then save exactly one proposal. Fill only shifts that are still below their staffNeeded count — leave fully staffed shifts untouched, and never add more people than a shift's remaining need. Any previous draft for that week is superseded automatically.`,
      }),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      return json(
        {
          error: `Agent session for week ${week} failed (HTTP ${response.status}): ${detail}`,
          sessions,
          sync,
        },
        502
      );
    }
    sessions.push({ weekStart: week, sessionId: response.headers.get('x-eve-session-id') });
  }

  // weekStart/sessionId mirror the first entry for the original single-week
  // response shape.
  return json(
    { ok: true, sessions, weekStart: weekStarts[0], sessionId: sessions[0]?.sessionId, sync },
    202
  );
};
