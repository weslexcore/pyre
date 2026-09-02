// The staff "Ask" box (/admin/ask): a natural-language question goes to
// the knowledge assistant in pyre-agents, which searches the SOP library,
// shift notes, water log, and incident reports on the asker's behalf and
// answers with links back here.
//
//   POST { question, session? }  → opens a knowledge session (or sends a
//                                  follow-up into the caller's own session)
//                                  and returns { sessionId, token, fresh,
//                                  nextIndex? } — nextIndex only for a
//                                  conversation reopened from the history
//                                  sidebar (session.resume), which the island
//                                  otherwise has no stream position for
//   GET  ?sessionId&token&startIndex → proxies the session's event stream
//                                  as a reduced NDJSON feed the island renders
//
// The session runs as the asker: their SOP role, email, and page grants ride
// in as the knowledge scope (lib/knowledge/scope.ts) and the agent's tools
// filter by them. A signed token binds each session to the session email so
// only its opener can continue or read it. Gated on the Ask page grant — the
// checkbox on /admin/users — so the assistant is opt-in per person.

import type { APIRoute } from 'astro';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import { createAskSessionToken, verifyAskSessionToken } from '@/lib/knowledge/ask-token';
import {
  buildAskMessage,
  knowledgeHeaders,
  knowledgeScopeFor,
  MAX_QUESTION_LENGTH,
  sanitizeQuestion,
} from '@/lib/knowledge/scope';
import { type AskStreamEvent, reduceStreamEvent, type UpstreamEvent } from '@/lib/knowledge/stream';
import type { EveConfig } from '@/lib/schedule/eve-session';
import {
  countEveSessionEvents,
  openEveSessionStream,
  readEveSessionTail,
  sendEveFollowUp,
  startEveSession,
} from '@/lib/schedule/eve-session';
import { normalizeEmail } from '@/lib/sops/levels';

export const prerender = false;

const PAGE = '/admin/ask';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function eveConfig(): EveConfig | null {
  const baseUrl = import.meta.env.AGENTS_BASE_URL;
  const channelSecret = import.meta.env.EVE_CHANNEL_SECRET;
  if (!baseUrl || !channelSecret) return null;
  return {
    baseUrl,
    channelSecret,
    bypassSecret: import.meta.env.AGENTS_PROTECTION_BYPASS,
  };
}

const AGENT_BUSY_ERROR = 'The assistant is still answering your last question — give it a moment';

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const config = eveConfig();
  if (!config) {
    return json({ error: 'Assistant not configured (AGENTS_BASE_URL / EVE_CHANNEL_SECRET)' }, 503);
  }

  let body: Record<string, unknown> = {};
  try {
    if (request.headers.get('content-type')?.includes('application/json')) {
      body = (await request.json()) as Record<string, unknown>;
    }
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  if (typeof body.question !== 'string') return json({ error: 'question is required' }, 400);
  if (body.question.length > MAX_QUESTION_LENGTH * 2) {
    return json({ error: `question must be ${MAX_QUESTION_LENGTH} characters or fewer` }, 400);
  }
  const question = sanitizeQuestion(body.question);
  if (!question) return json({ error: 'question is required' }, 400);

  const email = normalizeEmail(gate.user.email);
  const scope = await knowledgeScopeFor(gate);
  const sessionConfig: EveConfig = { ...config, headers: knowledgeHeaders(scope) };

  // A follow-up into the caller's own conversation, when it is still there.
  // `resume` marks a conversation reopened from the history sidebar: the
  // island holds no stream position for it, so the reply carries the index
  // to stream from (the session's event count before this follow-up).
  const session = body.session as { id?: unknown; token?: unknown; resume?: unknown } | undefined;
  if (
    session &&
    typeof session.id === 'string' &&
    typeof session.token === 'string' &&
    verifyAskSessionToken(session.token, session.id, email)
  ) {
    const tail = await readEveSessionTail(sessionConfig, session.id);
    if (tail.state === 'running') return json({ error: AGENT_BUSY_ERROR }, 409);
    if (tail.state === 'waiting') {
      const nextIndex =
        session.resume === true
          ? await countEveSessionEvents(sessionConfig, session.id, tail.continuationToken)
          : undefined;
      // A resume whose log could not be measured is treated as gone: a
      // fresh session beats streaming the new answer from a guessed index.
      if (nextIndex !== null) {
        const sent = await sendEveFollowUp(
          sessionConfig,
          session.id,
          tail.continuationToken,
          buildAskMessage(question, true)
        );
        if (sent.ok) {
          return json(
            {
              ok: true,
              sessionId: session.id,
              token: session.token,
              fresh: false,
              ...(nextIndex !== undefined ? { nextIndex } : {}),
            },
            202
          );
        }
        if (sent.reason === 'running') return json({ error: AGENT_BUSY_ERROR }, 409);
        return json({ error: `Assistant follow-up failed: ${sent.detail}` }, 502);
      }
    }
    // 'gone' — fall through to a fresh session; the island tells the reader.
  }

  let sessionId: string | null;
  try {
    sessionId = await startEveSession(sessionConfig, buildAskMessage(question));
  } catch (error) {
    return json(
      {
        error: `Assistant session failed: ${error instanceof Error ? error.message : String(error)}`,
      },
      502
    );
  }
  if (!sessionId) return json({ error: 'Assistant session failed: no session id returned' }, 502);

  const token = createAskSessionToken(sessionId, email);
  if (!token) return json({ error: 'Assistant not configured (EVE_CHANNEL_SECRET)' }, 503);

  return json({ ok: true, sessionId, token, fresh: true }, 202);
};

/** Leave the function budget (60s) headroom; the island resumes from nextIndex. */
const STREAM_BUDGET_MS = 50_000;

export const GET: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;

  const config = eveConfig();
  if (!config) {
    return json({ error: 'Assistant not configured (AGENTS_BASE_URL / EVE_CHANNEL_SECRET)' }, 503);
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId') ?? '';
  const token = url.searchParams.get('token') ?? '';
  const startIndex = Number.parseInt(url.searchParams.get('startIndex') ?? '0', 10);
  if (!sessionId || !token || !Number.isFinite(startIndex) || startIndex < 0) {
    return json({ error: 'sessionId, token, and startIndex are required' }, 400);
  }
  if (!verifyAskSessionToken(token, sessionId, normalizeEmail(gate.user.email))) {
    return json({ error: 'Not your conversation' }, 403);
  }

  const abort = new AbortController();
  const upstream = await openEveSessionStream(config, sessionId, startIndex, abort.signal);
  if (!upstream?.body) {
    return json(
      { error: 'That conversation is no longer available — ask again to start a new one' },
      404
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();
  const deadline = Date.now() + STREAM_BUDGET_MS;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let index = startIndex;
      let buffer = '';
      let closed = false;
      const emit = (event: AskStreamEvent) => {
        if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        abort.abort();
        controller.close();
      };

      const timer = setTimeout(() => abort.abort(), Math.max(0, deadline - Date.now()));
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (value) buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let event: UpstreamEvent;
            try {
              event = JSON.parse(trimmed) as UpstreamEvent;
            } catch {
              continue;
            }
            index += 1;
            const reduced = reduceStreamEvent(event, index);
            if (!reduced) continue;
            emit(reduced);
            if (reduced.type === 'done') {
              clearTimeout(timer);
              finish();
              return;
            }
          }
          if (done) break;
        }
        // Upstream closed without a turn boundary: the island resumes from here.
        emit({ type: 'done', status: 'gone', nextIndex: index });
      } catch {
        emit({ type: 'done', status: 'timeout', nextIndex: index });
      } finally {
        clearTimeout(timer);
        finish();
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
};
