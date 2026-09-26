// Server-side helpers for the pyre-agents Eve HTTP channel (/eve/v1/session*),
// shared by the draft trigger, the refine route, and the Ask box. Auth is the
// channel secret; AGENTS_PROTECTION_BYPASS gets requests past Vercel
// Deployment Protection on preview deployments (edge layer only — the channel
// secret is still what authenticates us to the agent).
//
// Sessions are addressed by id alone (eve ≥ 0.31): a follow-up is a POST to
// /eve/v1/session/:id, with no continuation token to carry or persist. The
// stream's tail (?startIndex=-1) doubles as a state probe — `session.waiting`
// means parked and resumable, a terminal event means gone, anything else
// means mid-turn — and ?includeTailIndex=1 reports how many events the log
// holds, which is where a caller streams from to see only its follow-up.

export interface EveConfig {
  baseUrl: string;
  channelSecret: string;
  /** Vercel Deployment Protection bypass secret, if configured. */
  bypassSecret?: string | null;
  /**
   * Extra request headers, e.g. the role headers that make pyre-agents run a
   * session as the knowledge assistant (lib/knowledge/scope.ts). Sent on
   * every call for the session, though only session creation reads them.
   */
  headers?: Record<string, string>;
}

export type EveSessionTail =
  /** Parked and resumable: the next follow-up starts a new turn. */
  | { state: 'waiting' }
  /** A turn is in flight. */
  | { state: 'running' }
  /** Completed, failed, or unknown — start a fresh session instead. */
  | { state: 'gone' };

function headers(config: EveConfig, json = true): Record<string, string> {
  return {
    Authorization: `Bearer ${config.channelSecret}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(config.bypassSecret ? { 'x-vercel-protection-bypass': config.bypassSecret } : {}),
    ...(config.headers ?? {}),
  };
}

/**
 * Open a session's NDJSON event stream from an absolute event index. Returns
 * the raw upstream Response (the caller owns reading and aborting it), or
 * null when the session is unknown or the stream cannot be opened.
 */
export async function openEveSessionStream(
  config: EveConfig,
  sessionId: string,
  startIndex: number,
  signal?: AbortSignal
): Promise<Response | null> {
  try {
    const response = await fetch(
      sessionUrl(config, `/${sessionId}/stream?startIndex=${Math.max(0, Math.floor(startIndex))}`),
      { headers: headers(config, false), signal }
    );
    if (!response.ok || !response.body) return null;
    return response;
  } catch {
    return null;
  }
}

function sessionUrl(config: EveConfig, path = ''): string {
  return `${config.baseUrl.replace(/\/$/, '')}/eve/v1/session${path}`;
}

/**
 * Start a new Eve session with an opening message. Returns the session id
 * from the x-eve-session-id header (null if the header is missing).
 * Throws with the response detail on a non-2xx.
 */
export async function startEveSession(config: EveConfig, message: string): Promise<string | null> {
  const response = await fetch(sessionUrl(config), {
    method: 'POST',
    headers: headers(config),
    body: JSON.stringify({ message }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Agent session failed (HTTP ${response.status}): ${detail}`);
  }
  return response.headers.get('x-eve-session-id');
}

/** Give the tail read this long before treating the session as unreachable. */
const TAIL_READ_TIMEOUT_MS = 10_000;

/**
 * Classify a tail stream event (the parsed first NDJSON line of a
 * ?startIndex=-1 read). Exported for tests.
 */
export function classifyTailEvent(event: unknown): EveSessionTail {
  const e = event as { type?: string } | null;
  if (!e?.type) return { state: 'gone' };
  if (e.type === 'session.waiting') return { state: 'waiting' };
  if (e.type === 'session.completed' || e.type === 'session.failed') {
    return { state: 'gone' };
  }
  return { state: 'running' };
}

/**
 * Classify a session's tail event: waiting, running, or gone. The stream endpoint holds its connection open,
 * so this reads only the first NDJSON line (the current latest event with
 * startIndex=-1) and aborts. Network/parse failures classify as 'gone' —
 * the caller's fallback (fresh session) is the safe recovery either way.
 */
export async function readEveSessionTail(
  config: EveConfig,
  sessionId: string
): Promise<EveSessionTail> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), TAIL_READ_TIMEOUT_MS);
  try {
    const response = await fetch(sessionUrl(config, `/${sessionId}/stream?startIndex=-1`), {
      headers: headers(config, false),
      signal: abort.signal,
    });
    if (!response.ok || !response.body) return { state: 'gone' };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (!buffer.includes('\n')) {
        const { value, done } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });
        if (done) break;
      }
    } finally {
      abort.abort(); // release the held-open stream
    }
    const firstLine = buffer.split('\n')[0]?.trim();
    if (!firstLine) return { state: 'gone' };
    return classifyTailEvent(JSON.parse(firstLine));
  } catch {
    return { state: 'gone' };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * How many events a session has written so far — the index a caller streams
 * from to see only what its next follow-up produces. Read from the stream's
 * x-eve-stream-tail-index header (the zero-based index of the last recorded
 * event), without reading any events. Null when the session cannot be read;
 * the caller's fallback is a fresh session.
 */
export async function countEveSessionEvents(
  config: EveConfig,
  sessionId: string
): Promise<number | null> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), TAIL_READ_TIMEOUT_MS);
  try {
    const response = await fetch(
      sessionUrl(config, `/${sessionId}/stream?startIndex=-1&includeTailIndex=1`),
      { headers: headers(config, false), signal: abort.signal }
    );
    const tail = Number.parseInt(response.headers.get('x-eve-stream-tail-index') ?? '', 10);
    return response.ok && Number.isFinite(tail) ? tail + 1 : null;
  } catch {
    return null;
  } finally {
    abort.abort(); // release the held-open stream
    clearTimeout(timeout);
  }
}

export type FollowUpResult =
  | { ok: true }
  /** Another turn is still running and did not take this one. */
  | { ok: false; reason: 'running' }
  /** The session ended (409 session_not_active); start a fresh one. */
  | { ok: false; reason: 'gone' }
  | { ok: false; reason: 'error'; detail: string };

/** A just-created session's inbox can take a moment to open (409 session_not_ready). */
const NOT_READY_RETRIES = 4;
const NOT_READY_DELAY_MS = 500;

/**
 * Send a follow-up message into an existing session. pyre-agents queues
 * follow-ups behind an active turn (turnPolicy "queue" on its channel), so a
 * send that races another only waits its turn; callers still check the tail
 * first so a person is told the assistant is busy rather than left queued.
 */
export async function sendEveFollowUp(
  config: EveConfig,
  sessionId: string,
  message: string
): Promise<FollowUpResult> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(sessionUrl(config, `/${sessionId}`), {
      method: 'POST',
      headers: headers(config),
      body: JSON.stringify({ message }),
    });
    if (response.ok) return { ok: true };
    const detail = (await response.text()).slice(0, 300);
    let code: unknown;
    try {
      code = (JSON.parse(detail) as { code?: unknown }).code;
    } catch {
      code = undefined;
    }
    if (code === 'session_not_active') return { ok: false, reason: 'gone' };
    if (code === 'session_not_ready' && attempt < NOT_READY_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, NOT_READY_DELAY_MS * (attempt + 1)));
      continue;
    }
    if (response.status === 409) return { ok: false, reason: 'running' };
    return { ok: false, reason: 'error', detail: `HTTP ${response.status}: ${detail}` };
  }
}
