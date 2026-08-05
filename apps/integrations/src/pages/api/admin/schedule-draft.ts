// "Draft schedule" trigger: sync Momence coverage windows first (so the agent
// sees current reality), then start a pyre-agents Eve session that drafts the
// requested week. Returns immediately with the session id — the board polls
// for the resulting proposal rather than holding this request open through
// the agent run.

import { weekStartOf } from '@pyre/schedule-core';
import type { APIRoute } from 'astro';
import { assertSameOrigin, requireScheduleManage } from '@/lib/auth/admin';
import { type SyncShiftsSummary, syncShifts } from '@/lib/schedule/sync';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  let body: Record<string, unknown> = {};
  try {
    if (request.headers.get('content-type')?.includes('application/json')) {
      body = (await request.json()) as Record<string, unknown>;
    }
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const weekStart = body.weekStart;
  if (
    typeof weekStart !== 'string' ||
    !DATE_RE.test(weekStart) ||
    weekStartOf(weekStart) !== weekStart
  ) {
    return json({ error: 'weekStart must be a Monday as YYYY-MM-DD' }, 400);
  }

  // Fresh windows before drafting — a stale board is the agent's worst input.
  let sync: SyncShiftsSummary | { error: string };
  try {
    sync = await syncShifts();
  } catch (error) {
    // Draft anyway on sync failure (Momence hiccups shouldn't block a manual
    // draft of already-synced shifts), but tell the admin.
    sync = { error: error instanceof Error ? error.message : 'Sync failed' };
  }

  const response = await fetch(`${agentsBaseUrl.replace(/\/$/, '')}/eve/v1/session`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${channelSecret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `Draft the staffing schedule for the week starting ${weekStart}. Use get_week_context with weekStart "${weekStart}", then save exactly one proposal. Any previous draft for that week is superseded automatically.`,
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    return json({ error: `Agent session failed (HTTP ${response.status}): ${detail}`, sync }, 502);
  }

  const sessionId = response.headers.get('x-eve-session-id');
  return json({ ok: true, sessionId, weekStart, sync }, 202);
};
