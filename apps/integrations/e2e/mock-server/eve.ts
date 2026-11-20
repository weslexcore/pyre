// A stand-in for pyre-agents (the Eve app) under /agents, so the app's agent
// features run for real against the e2e stack: the app opens sessions, sends
// follow-ups and reads session streams exactly as it does in production
// (lib/schedule/eve-session.ts), and the "agent" calls the app back through
// its real /api/agent/* routes.
//
// No model runs here. What a Pyre Agent (knowledge) session does is scripted
// by the spec (e2e/eve.ts): each turn is a list of tool calls and an answer.
// The mock carries out each call the way pyre-agents' tools do (the same
// /api/agent/pyre ops and the same wrapping of results), writes the turn to
// the audit log the chat reads back (knowledge_queries), reports a routine
// run's end (/api/agent/routines), and records the events the chat streams.
// So which tool the model would choose is not tested here; what the app does
// with each call is.
//
// Scheduler sessions (the board's Draft button, a Pyre Agent draft) and
// suggester sessions only park: the spec plays the scheduler by saving a
// proposal through /api/agent/proposals with the session id, and the
// suggester by saving through /api/agent/suggestions with the session's run
// (recorded from its headers, with the record it is about).
//
//   POST /agents/eve/v1/session               open a session ({ message })
//   POST /agents/eve/v1/session/:id           a follow-up ({ message })
//   GET  /agents/eve/v1/session/:id/stream    the event log as NDJSON
//                                             (?startIndex=-1: the newest event)
//
// Control API for specs (e2e/eve.ts):
//   POST /agents/__scripts                    { match, turns } — a knowledge
//                                             session whose opening message
//                                             contains `match` plays `turns`
//   GET  /agents/__sessions                   every session and its messages
//   POST /agents/__sessions/:id               { state } — park it ('waiting'),
//                                             make it busy ('running') or end
//                                             it ('gone')

import type { MockRequest, MockResponse, MockRoute } from '@pyre/e2e-utils/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AGENT_API_SECRET, AGENTS_PATH, EVE_CHANNEL_SECRET } from '../agent-secrets';
import { APP_URL } from '../ports';

export type EveRole = 'scheduler' | 'knowledge' | 'suggester';
export type EveState = 'waiting' | 'running' | 'gone';

export interface ScriptCall {
  tool: string;
  input: Record<string, unknown>;
}

export interface ScriptTurn {
  calls?: ScriptCall[];
  answer: string;
}

export interface EveSessionView {
  id: string;
  role: EveRole;
  state: EveState;
  scope: Record<string, unknown> | null;
  routineRunId: string | null;
  /** Suggester sessions: the run to save into, and the record (`shift_note:<id>`). */
  suggestRunId: string | null;
  suggestSource: string | null;
  /** When it was opened (ms since the epoch), so a spec sees only its own. */
  createdAt: number;
  messages: string[];
  /** Each scripted call's output, in order, for knowledge sessions. */
  outputs: Array<{ tool: string; output: unknown }>;
}

interface EveEvent {
  type: string;
  data?: Record<string, unknown>;
}

interface Session extends EveSessionView {
  events: EveEvent[];
  turns: ScriptTurn[];
  turnCount: number;
}

const SESSION_BASE = `${AGENTS_PATH}/eve/v1/session`;
const sessions = new Map<string, Session>();
const scripts: Array<{ match: string; turns: ScriptTurn[] }> = [];
let sequence = 0;

let supabase: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('mock Eve needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return supabase;
}

function header(request: MockRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function authorized(request: MockRequest): boolean {
  return header(request, 'authorization') === `Bearer ${EVE_CHANNEL_SECRET}`;
}

const unauthorized: MockResponse = { status: 401, json: { code: 'unauthorized' } };

/** The question inside a knowledge message's <staff-question> block, as the audit hook records it. */
function questionOf(message: string): string {
  const match = /<staff-question>\n?([\s\S]*?)\n?<\/staff-question>/.exec(message);
  return (match?.[1] ?? message).trim();
}

/** One call to the app's /api/agent/* as pyre-agents makes it. */
async function callApp(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${APP_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AGENT_API_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let parsed: Record<string, unknown>;
  try {
    parsed = (await response.json()) as Record<string, unknown>;
  } catch {
    parsed = { error: `Non-JSON response (HTTP ${response.status})` };
  }
  return { status: response.status, body: parsed };
}

/**
 * A schedule-draft tool, carried out as pyre-agents' lib/knowledge/schedule-drafts.ts
 * does: refused before the network without the scope's grant, otherwise one
 * /api/agent/pyre op as the person, its result wrapped the same way.
 */
async function runTool(session: Session, call: ScriptCall): Promise<unknown> {
  const scope = session.scope ?? {};
  const email = typeof scope.email === 'string' ? scope.email : '';
  if (call.tool.includes('schedule') && scope.scheduleManage !== true) {
    return {
      error:
        'This person cannot manage the schedule, so they cannot draft or confirm one. A schedule manager or an admin can.',
    };
  }
  const pyre = async (op: string, input: Record<string, unknown>) => {
    const { status, body } = await callApp('/api/agent/pyre', {
      email,
      sessionId: session.id,
      op,
      input,
    });
    return status >= 400
      ? { error: typeof body.error === 'string' ? body.error : `Request failed (HTTP ${status})` }
      : body;
  };
  switch (call.tool) {
    case 'get_schedule_draft':
      return pyre('schedule_draft', call.input);
    case 'draft_schedule':
    case 'revise_schedule_draft': {
      const result = await pyre(
        call.tool === 'draft_schedule' ? 'schedule_start' : 'schedule_revise',
        call.input
      );
      if ('error' in result) return result;
      return {
        ...result,
        scheduleDraft: { weekStart: call.input.weekStart },
        note: 'Started, not finished.',
      };
    }
    case 'propose_schedule_review': {
      const result = await pyre('propose', { ...call.input, kind: 'schedule.review' });
      if ('error' in result) return result;
      return { ...result, note: 'Proposed, not applied.' };
    }
    default:
      throw new Error(`mock Eve has no tool ${call.tool}`);
  }
}

/** Upsert the turn's audit row the way pyre-agents' lib/knowledge/audit.ts does. */
async function audit(session: Session, turnId: string, fields: Record<string, unknown>) {
  const { error } = await db()
    .from('knowledge_queries')
    .upsert(
      {
        session_id: session.id,
        turn_id: turnId,
        asked_by: String(session.scope?.email ?? ''),
        viewer_scope: session.scope ?? {},
        ...fields,
      },
      { onConflict: 'session_id,turn_id' }
    );
  if (error) console.error('[mock eve] audit failed:', error.message);
}

/** Play the session's next scripted turn to the end, as one agent turn. */
async function runKnowledgeTurn(session: Session, message: string): Promise<void> {
  const turn = session.turns[session.turnCount] ?? {
    answer: 'The mock agent has no scripted turn for this message.',
  };
  session.turnCount += 1;
  const turnId = `turn-${session.turnCount}`;
  const question = questionOf(message);
  session.state = 'running';
  session.events.push({ type: 'turn.started', data: { turnId } });
  await audit(session, turnId, { question, status: 'pending' });

  const trail: Record<string, unknown>[] = [];
  const toolCalls: Record<string, unknown>[] = [];
  for (const [index, call] of (turn.calls ?? []).entries()) {
    const callId = `${turnId}-call-${index + 1}`;
    session.events.push({
      type: 'actions.requested',
      data: { actions: [{ kind: 'tool-call', toolName: call.tool, callId, input: call.input }] },
    });
    const output = await runTool(session, call);
    session.outputs.push({ tool: call.tool, output });
    session.events.push({
      type: 'action.result',
      data: { status: 'completed', result: { kind: 'tool-result', callId, output } },
    });
    toolCalls.push({ tool: call.tool, input: call.input });
    trail.push({
      kind: 'tool',
      callId,
      tool: call.tool,
      input: call.input,
      status: 'completed',
      output: JSON.stringify(output, null, 2),
    });
  }

  session.events.push({
    type: 'message.completed',
    data: { message: turn.answer, finishReason: 'stop' },
  });
  await audit(session, turnId, {
    question,
    answer: turn.answer,
    trail,
    tool_calls: toolCalls,
    status: 'answered',
    answered_at: new Date().toISOString(),
  });
  session.events.push({ type: 'session.waiting' });
  session.state = 'waiting';

  // A routine's run is reported back on when its turn ends. pyre-agents
  // reports after the app has stored the run's session (the turn outlives the
  // request that opened it); this turn finished inside that request, so the
  // report waits a moment for the same order.
  const runId = session.routineRunId;
  if (runId) {
    setTimeout(() => {
      void callApp('/api/agent/routines', { runId, sessionId: session.id }).catch((error) =>
        console.error('[mock eve] routine report failed:', error)
      );
    }, 1000);
  }
}

function sessionIdOf(path: string): string {
  return decodeURIComponent(path.slice(SESSION_BASE.length + 1).split('/')[0] ?? '');
}

async function openSession(request: MockRequest): Promise<MockResponse> {
  if (!authorized(request)) return unauthorized;
  const message = String((request.body as { message?: unknown })?.message ?? '');
  const role = (header(request, 'x-pyre-agent') ?? 'scheduler') as EveRole;
  let scope: Record<string, unknown> | null = null;
  try {
    scope = JSON.parse(header(request, 'x-pyre-knowledge-scope') ?? 'null');
  } catch {
    scope = null;
  }
  const id = `e2e-eve-${role}-${Date.now().toString(36)}-${++sequence}`;
  const script = role === 'knowledge' ? scripts.find((s) => message.includes(s.match)) : undefined;
  const session: Session = {
    id,
    role,
    state: 'waiting',
    scope,
    routineRunId: header(request, 'x-pyre-routine-run') ?? null,
    suggestRunId: header(request, 'x-pyre-suggest-run') ?? null,
    suggestSource: header(request, 'x-pyre-suggest-source') ?? null,
    createdAt: Date.now(),
    messages: [message],
    outputs: [],
    events: [],
    turns: script?.turns ?? [],
    turnCount: 0,
  };
  sessions.set(id, session);
  if (role === 'knowledge') {
    await runKnowledgeTurn(session, message);
  } else {
    // A scheduler (or suggester) turn: the spec plays it through the app's
    // agent API; the session parks waiting for a follow-up.
    session.events.push({ type: 'turn.started', data: { turnId: 'turn-1' } });
    session.events.push({ type: 'session.waiting' });
  }
  return { json: { sessionId: id }, headers: { 'x-eve-session-id': id } };
}

async function followUp(request: MockRequest): Promise<MockResponse> {
  if (!authorized(request)) return unauthorized;
  const session = sessions.get(sessionIdOf(request.path));
  if (!session || session.state === 'gone') {
    return { status: 409, json: { code: 'session_not_active' } };
  }
  if (session.state === 'running') return { status: 409, json: { code: 'session_busy' } };
  const message = String((request.body as { message?: unknown })?.message ?? '');
  session.messages.push(message);
  if (session.role === 'knowledge') {
    await runKnowledgeTurn(session, message);
  } else {
    session.events.push({
      type: 'turn.started',
      data: { turnId: `turn-${session.messages.length}` },
    });
    session.events.push({ type: 'session.waiting' });
  }
  return { json: { ok: true } };
}

/** What the stream ends on now, for a session a spec moved to `state`. */
function stateEvent(state: EveState): EveEvent {
  return state === 'running'
    ? { type: 'turn.started', data: { turnId: 'busy' } }
    : state === 'gone'
      ? { type: 'session.completed' }
      : { type: 'session.waiting' };
}

function stream(request: MockRequest): MockResponse {
  if (!authorized(request)) return unauthorized;
  const session = sessions.get(sessionIdOf(request.path));
  if (!session) return { status: 404, json: { code: 'session_not_found' } };
  const events = [...session.events];
  const last = events[events.length - 1];
  if (!last || last.type !== stateEvent(session.state).type) events.push(stateEvent(session.state));
  const start = Number.parseInt(request.query.get('startIndex') ?? '0', 10);
  const lines = start < 0 ? events.slice(-1) : events.slice(Math.max(0, start));
  return {
    // Eve opens the stream with a keep-alive line before the first event.
    text: `\n${lines.map((e) => JSON.stringify(e)).join('\n')}\n`,
    headers: {
      'Content-Type': 'application/x-ndjson',
      'x-eve-stream-tail-index': String(events.length - 1),
    },
  };
}

function view(session: Session): EveSessionView {
  const {
    id,
    role,
    state,
    scope,
    routineRunId,
    suggestRunId,
    suggestSource,
    createdAt,
    messages,
    outputs,
  } = session;
  return {
    id,
    role,
    state,
    scope,
    routineRunId,
    suggestRunId,
    suggestSource,
    createdAt,
    messages,
    outputs,
  };
}

export function eveRoutes(): MockRoute[] {
  const sessionPath = new RegExp(`^${SESSION_BASE}/[^/]+$`);
  const streamPath = new RegExp(`^${SESSION_BASE}/[^/]+/stream$`);
  const controlPath = new RegExp(`^${AGENTS_PATH}/__sessions/[^/]+$`);
  return [
    { method: 'POST', path: SESSION_BASE, handler: openSession },
    { method: 'POST', path: sessionPath, handler: followUp },
    { path: streamPath, handler: stream },
    // -- Control API ---------------------------------------------------------
    {
      method: 'POST',
      path: `${AGENTS_PATH}/__scripts`,
      handler: ({ body }) => {
        const { match, turns } = (body ?? {}) as { match?: unknown; turns?: unknown };
        if (typeof match !== 'string' || !match || !Array.isArray(turns)) {
          return { status: 400, json: { error: 'match and turns are required' } };
        }
        scripts.unshift({ match, turns: turns as ScriptTurn[] });
        return { json: { ok: true } };
      },
    },
    {
      path: `${AGENTS_PATH}/__sessions`,
      handler: () => ({ json: [...sessions.values()].map(view) }),
    },
    {
      method: 'POST',
      path: controlPath,
      handler: ({ path, body }) => {
        const session = sessions.get(decodeURIComponent(path.split('/').pop() ?? ''));
        const state = (body as { state?: unknown })?.state;
        if (!session) return { status: 404, json: { error: 'no such session' } };
        if (state !== 'waiting' && state !== 'running' && state !== 'gone') {
          return { status: 400, json: { error: 'state must be waiting, running or gone' } };
        }
        session.state = state;
        return { json: view(session) };
      },
    },
  ];
}
