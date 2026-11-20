// Shared by the Pyre Agent specs: the mock Eve app's control API
// (mock-server/eve.ts), the scheduling agent's side of a draft (saving its
// proposal through the app's real /api/agent/proposals), and a `test` that
// gives each test a calendar week of its own (schedule-helpers.ts) and
// removes every draft, request, proposal and conversation it made there.

import type { APIRequestContext, Page } from '@playwright/test';
import { uniqueTag } from '@pyre/e2e-utils';
import { addDays, todayEastern } from '@pyre/schedule-core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AGENT_API_SECRET, AGENTS_PATH } from './agent-secrets';
import type { EveSessionView, EveState, ScriptTurn } from './mock-server/eve';
import { MOCK_URL } from './ports';
import { OFF_SHIFT_DUTY, type Role } from './roles';
import { test as base, expect } from './schedule-helpers';
import { open } from './test';

export { OFF_SHIFT_DUTY };

const agentAuth = { Authorization: `Bearer ${AGENT_API_SECRET}` };

/** The mock Eve app's control API. */
export const eve = {
  /** A knowledge session whose opening message contains `match` plays `turns`, one per message. */
  async script(match: string, turns: ScriptTurn[]): Promise<void> {
    const response = await fetch(`${MOCK_URL}${AGENTS_PATH}/__scripts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ match, turns }),
    });
    expect(response.ok, 'script the mock agent').toBe(true);
  },
  async sessions(): Promise<EveSessionView[]> {
    return (await (await fetch(`${MOCK_URL}${AGENTS_PATH}/__sessions`)).json()) as EveSessionView[];
  },
  async session(id: string): Promise<EveSessionView> {
    const found = (await eve.sessions()).find((s) => s.id === id);
    if (!found) throw new Error(`The mock agent has no session ${id}`);
    return found;
  },
  /**
   * Scheduler sessions opened for one week since `since` (ms), oldest first.
   * Weeks are reused by later tests on the same worker, and the mock keeps
   * every session, so specs go through the `agent` fixture, which passes the
   * test's start.
   */
  async schedulerSessions(weekStart: string, since = 0): Promise<EveSessionView[]> {
    return (await eve.sessions()).filter(
      (s) =>
        s.role === 'scheduler' &&
        s.createdAt >= since &&
        s.messages.some((m) => m.includes(weekStart))
    );
  },
  /** Knowledge sessions whose opening message contains `match`. */
  async knowledgeSessions(match: string): Promise<EveSessionView[]> {
    return (await eve.sessions()).filter(
      (s) => s.role === 'knowledge' && s.messages[0]?.includes(match)
    );
  },
  async setState(id: string, state: EveState): Promise<void> {
    const response = await fetch(`${MOCK_URL}${AGENTS_PATH}/__sessions/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });
    expect(response.ok, `move ${id} to ${state}`).toBe(true);
  },
};

/** What the scheduling agent's save_proposal sends. */
export interface DraftPayload {
  weekStart: string;
  agentSessionId: string;
  rationale?: string;
  summary?: { uncoveredShifts?: number; warnings?: string[] };
  shifts?: Array<{
    key: string;
    shiftDate: string;
    label: string;
    startsAt: string;
    endsAt: string;
    staffNeeded: number;
  }>;
  assignments?: Array<{
    shiftId?: string;
    shiftKey?: string;
    staffId: string;
    duties?: string[];
  }>;
  dutyAssignments?: Array<{ dutyKey: string; date: string; staffId: string }>;
}

/** Play the scheduling agent: save its draft for the week, as save_proposal does. */
export async function saveDraft(
  request: APIRequestContext,
  payload: DraftPayload
): Promise<string> {
  const response = await request.post('/api/agent/proposals', {
    headers: agentAuth,
    data: {
      rationale: 'E2E draft rationale.',
      summary: { uncoveredShifts: 0, partialAvailabilityPlacements: 0, warnings: [] },
      shifts: [],
      assignments: [],
      dutyAssignments: [],
      source: 'manual',
      ...payload,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { proposalId: string }).proposalId;
}

/** One /api/agent/pyre call as pyre-agents makes it for `email`. */
export async function pyreOp(
  request: APIRequestContext,
  email: string,
  op: string,
  input: Record<string, unknown>,
  sessionId = 'e2e-direct-session'
) {
  const response = await request.post('/api/agent/pyre', {
    headers: agentAuth,
    data: { email, sessionId, op, input },
  });
  return { status: response.status(), body: (await response.json()) as Record<string, unknown> };
}

/** Ask Pyre Agent in the chat and wait for the answer. */
export async function ask(page: Page, question: string, answer: string | RegExp): Promise<void> {
  const composer = page.getByLabel('Your question');
  await composer.fill(question);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(answer).last()).toBeVisible({ timeout: 30_000 });
}

/** Open the Pyre Agent chat, optionally on one conversation. */
export async function openChat(page: Page, conversation?: string): Promise<void> {
  await open(
    page,
    conversation ? `/admin/ask?c=${encodeURIComponent(conversation)}` : '/admin/ask'
  );
}

/** The draft card for a week in the chat. */
export function draftCard(page: Page, weekLabel: string) {
  return page.getByRole('region', { name: `Schedule draft for the week of ${weekLabel}` });
}

/** "Mon Nov 30" for a YYYY-MM-DD, as the app labels a week. */
export function weekLabel(weekStart: string): string {
  return new Date(`${weekStart}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function check(error: { message: string } | null, what: string) {
  if (error) throw new Error(`${what}: ${error.message}`);
}

/** Remove a week's drafts and everything hanging off them. */
async function clearDrafts(db: SupabaseClient, weekStart: string): Promise<void> {
  const { data, error } = await db
    .from('schedule_proposals')
    .select('id')
    .eq('week_start', weekStart);
  check(error, `read proposals for ${weekStart}`);
  const ids = ((data ?? []) as { id: string }[]).map((p) => p.id);
  if (ids.length > 0) {
    check(
      (await db.from('shift_assignments').delete().in('proposal_id', ids)).error,
      'clear drafted assignments'
    );
    check((await db.from('shifts').delete().in('proposal_id', ids)).error, 'clear drafted shifts');
    check(
      (await db.from('duty_assignments').delete().in('proposal_id', ids)).error,
      'clear drafted duties'
    );
    check(
      (await db.from('staff_notifications').delete().in('source_id', ids)).error,
      'clear draft notifications'
    );
  }
  check(
    (await db.from('schedule_draft_messages').delete().eq('week_start', weekStart)).error,
    'clear draft threads'
  );
  check(
    (await db.from('schedule_draft_requests').delete().eq('week_start', weekStart)).error,
    'clear draft requests'
  );
  check(
    (await db.from('schedule_proposals').delete().eq('week_start', weekStart)).error,
    'clear proposals'
  );
  check(
    (
      await db
        .from('duty_assignments')
        .delete()
        .eq('duty_key', OFF_SHIFT_DUTY.key)
        .gte('duty_date', weekStart)
        .lte('duty_date', addDays(weekStart, 6))
    ).error,
    'clear off-shift duties'
  );
}

/**
 * Remove the Pyre Agent conversations a test opened (by its marker): the
 * mock agent's sessions, plus proposals a test made straight through the
 * agent API under a session id that starts with the marker.
 */
async function clearConversations(db: SupabaseClient, marker: string): Promise<void> {
  const sessionIds = (await eve.sessions())
    .filter((s) => s.messages.some((m) => m.includes(marker)))
    .map((s) => s.id);
  check(
    (await db.from('pyre_agent_actions').delete().like('session_id', `${marker}%`)).error,
    'clear direct proposals'
  );
  if (sessionIds.length === 0) return;
  check(
    (await db.from('pyre_agent_actions').delete().in('session_id', sessionIds)).error,
    'clear proposals in the chat'
  );
  check(
    (await db.from('knowledge_queries').delete().in('session_id', sessionIds)).error,
    'clear the audit log'
  );
  for (const id of sessionIds) {
    check(
      (await db.from('staff_notifications').delete().like('href', `%${id}%`)).error,
      'clear chat notifications'
    );
  }
}

interface AgentFixtures {
  /** Monday of this test's own week (schedule-helpers' days.ahead()). */
  week: string;
  /** The scheduler sessions this test opened for its week, oldest first. */
  schedulerSessions: () => Promise<EveSessionView[]>;
  /** A string unique to this test, to put in every question so the mock agent finds its script. */
  marker: string;
  /** A day of this test's week, YYYY-MM-DD. */
  dayOf: (offset: number) => string;
}

export const test = base.extend<AgentFixtures>({
  week: async ({ db, days }, use) => {
    const week = addDays(todayEastern(), days.ahead(0));
    await clearDrafts(db, week);
    await use(week);
    await clearDrafts(db, week);
  },
  schedulerSessions: async ({ week }, use) => {
    const since = Date.now();
    await use(() => eve.schedulerSessions(week, since));
  },
  marker: async ({ db }, use, testInfo) => {
    const marker = uniqueTag(testInfo, 'E2E-PA').replace(/\s+/g, '-');
    await use(marker);
    await clearConversations(db, marker);
  },
  dayOf: async ({ week }, use) => {
    await use((offset) => addDays(week, offset));
  },
});

export { expect };

/** The staff notifications a person got about one proposal. */
export async function proposalNotices(db: SupabaseClient, email: string, proposalId: string) {
  const { data, error } = await db
    .from('staff_notifications')
    .select('kind, title, href, source_type, source_id')
    .eq('recipient_email', email)
    .eq('source_id', proposalId);
  check(error, 'read notifications');
  return data ?? [];
}

/** Schedule notifications a staff member got about shifts or proposals in a set. */
export async function scheduleNotices(db: SupabaseClient, email: string, sourceIds: string[]) {
  const { data, error } = await db
    .from('staff_notifications')
    .select('kind, title, source_type, source_id')
    .eq('recipient_email', email)
    .eq('kind', 'schedule_change')
    .in('source_id', sourceIds);
  check(error, 'read schedule notifications');
  return data ?? [];
}

/** A role's API client, signed in, that keeps cookies (the routes are CSRF-checked on Origin only). */
export type AsRole = (role: Role) => Promise<APIRequestContext>;
