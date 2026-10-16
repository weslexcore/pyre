// The board changes Pyre Agent proposed in a conversation, for the person in
// it: read them back to draw the cards in the chat, and apply or dismiss
// each one. Only the asker's own rows, and only with the agent page grant
// (/admin/ask).
//
// Applying replays the stored request through the board routes themselves
// (board-cards, board-events, boards, goal-kpis), handed this request's own
// cookies — so the change is made by the person, under their grants, with
// every rule, trail entry, and notification the board would give a click.
// A refused or failed change puts the row back to pending with the route's
// error, so the card can say why and be tried again.
//
//   GET  ?sessionId=…               → { actions }
//   POST { id, action: 'apply' }   → { action }   (409 when it is no longer pending)
//   POST { id, action: 'dismiss' } → { action }

import type { APIContext, APIRoute } from 'astro';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import { getDb, type PyreAgentActionRow } from '@/lib/db';
import { normalizeEmail } from '@/lib/email/address';
import { dbError, json } from '@/lib/http/route';
import { actionView, replayAction, type StepResponse } from '@/lib/pyre-agent/actions';
import { type ApplyStep, PYRE_AGENT_HREF } from '@/lib/pyre-agent/types';
import * as boardCards from './board-cards';
import * as boardEvents from './board-events';
import * as boards from './boards';
import * as goalKpis from './goal-kpis';

export const prerender = false;

const ROUTES: Record<string, Partial<Record<'POST' | 'PATCH', APIRoute>>> = {
  '/api/admin/board-cards': { POST: boardCards.POST, PATCH: boardCards.PATCH },
  '/api/admin/board-events': { POST: boardEvents.POST },
  '/api/admin/boards': { POST: boards.POST },
  '/api/admin/goal-kpis': { PATCH: goalKpis.PATCH },
};

/** Per conversation; a long planning chat proposes a few dozen at most. */
const MAX_ACTIONS = 200;

/** Past the function budget, an 'applying' row is a crashed apply, not a running one. */
const CLAIM_LAPSE_MS = 2 * 60 * 1000;

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, PYRE_AGENT_HREF);
  if (gate instanceof Response) return gate;
  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const sessionId = (url.searchParams.get('sessionId') ?? '').trim();
  if (!sessionId) return json({ error: 'sessionId is required' }, 400);

  const { data, error } = await db
    .from('pyre_agent_actions')
    .select('*')
    .eq('session_id', sessionId)
    .eq('asked_by', normalizeEmail(gate.user.email))
    .order('created_at', { ascending: true })
    .limit(MAX_ACTIONS);
  if (error) return dbError(error);
  return json({ actions: ((data ?? []) as PyreAgentActionRow[]).map(actionView) });
};

/** One stored call, run through its route as the person making this request. */
function runAsCaller(context: APIContext) {
  return async (step: ApplyStep): Promise<StepResponse> => {
    const handler = ROUTES[step.path]?.[step.method];
    if (!handler) return { status: 400, body: { error: 'Not a board change' } };
    const target = new URL(step.path, context.url);
    const headers = new Headers({ 'content-type': 'application/json' });
    for (const name of ['cookie', 'origin', 'referer', 'host']) {
      const value = context.request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const response = await handler({
      ...context,
      url: target,
      request: new Request(target, {
        method: step.method,
        headers,
        body: JSON.stringify(step.body),
      }),
    } as APIContext);
    let body: Record<string, unknown> = {};
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      // A route that answered without JSON: the status says enough.
    }
    return { status: response.status, body };
  };
}

export const POST: APIRoute = async (context) => {
  const { cookies, request } = context;
  const gate = await requirePage(cookies, PYRE_AGENT_HREF);
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const id = typeof body.id === 'string' ? body.id : '';
  const email = normalizeEmail(gate.user.email);

  const { data: found, error: readError } = await db
    .from('pyre_agent_actions')
    .select('*')
    .eq('id', id)
    .eq('asked_by', email)
    .maybeSingle();
  if (readError) return dbError(readError);
  const row = found as PyreAgentActionRow | null;
  if (!row) return json({ error: 'Proposal not found' }, 404);

  if (body.action === 'dismiss') {
    const { data, error } = await db
      .from('pyre_agent_actions')
      .update({ status: 'dismissed', decided_at: new Date().toISOString(), error: null })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle();
    if (error) return dbError(error);
    if (!data) return json({ error: 'That proposal was already decided' }, 409);
    return json({ action: actionView(data as PyreAgentActionRow) });
  }

  if (body.action !== 'apply') return json({ error: "action must be 'apply' or 'dismiss'" }, 400);

  // Claim it, so a double click or a second tab cannot apply it twice. A
  // claim left behind by a function that died mid-apply lapses after a while.
  const stale = new Date(Date.now() - CLAIM_LAPSE_MS).toISOString();
  const { data: claimed, error: claimError } = await db
    .from('pyre_agent_actions')
    .update({ status: 'applying', error: null })
    .eq('id', row.id)
    .or(`status.eq.pending,and(status.eq.applying,updated_at.lt.${stale})`)
    .select('*')
    .maybeSingle();
  if (claimError) return dbError(claimError);
  if (!claimed) return json({ error: 'That proposal was already decided' }, 409);

  let outcome: Awaited<ReturnType<typeof replayAction>>;
  try {
    outcome = await replayAction(db, claimed as PyreAgentActionRow, runAsCaller(context));
  } catch (error) {
    outcome = { ok: false, error: error instanceof Error ? error.message : 'The change failed' };
  }

  const update = outcome.ok
    ? {
        status: 'applied',
        decided_at: new Date().toISOString(),
        result_label: outcome.label.slice(0, 300),
        result_href: outcome.href,
        error: outcome.warning,
      }
    : { status: 'pending', error: outcome.error.slice(0, 1000) };
  const { data, error } = await db
    .from('pyre_agent_actions')
    .update(update)
    .eq('id', row.id)
    .select('*')
    .single();
  if (error) return dbError(error);
  const action = actionView(data as PyreAgentActionRow);
  return json({ action }, outcome.ok ? 200 : 422);
};
