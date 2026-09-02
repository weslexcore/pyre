// Server-side helpers for the pyre-agents Eve HTTP channel (/eve/v1/session*),
// shared by the draft trigger and the refine route. Auth is the channel
// secret; AGENTS_PROTECTION_BYPASS gets requests past Vercel Deployment
// Protection on preview deployments (edge layer only — the channel secret is
// still what authenticates us to the agent).
//
// The continuation token is deliberately never persisted: it rotates on every
// turn, cron sessions never pass through this app, and Eve's stream tail
// (?startIndex=-1) hands the current token back to anyone holding just the
// session id — the last event of a resumable session is `session.waiting`
// carrying data.continuationToken. The same read doubles as a state probe:
// any other tail event means the session is mid-turn or gone for good.

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
  /** Parked and resumable; the token to send the next follow-up with. */
  | { state: 'waiting'; continuationToken: string }
  /** A turn is in flight (or another caller just took the continuation). */
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
  const e = event as { type?: string; data?: { continuationToken?: string } } | null;
  if (!e?.type) return { state: 'gone' };
  if (e.type === 'session.waiting') {
    // A waiting event always carries the token; one without it can't be
    // resumed, and the fresh-session fallback is the useful recovery.
    return typeof e.data?.continuationToken === 'string'
      ? { state: 'waiting', continuationToken: e.data.continuationToken }
      : { state: 'gone' };
  }
  if (e.type === 'session.completed' || e.type === 'session.failed') {
    return { state: 'gone' };
  }
  return { state: 'running' };
}

/**
 * Classify a session's tail event: waiting (with the current continuation
 * token), running, or gone. The stream endpoint holds its connection open,
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

export type FollowUpResult =
  | { ok: true }
  /** The continuation was taken by another turn between probe and send. */
  | { ok: false; reason: 'running' }
  | { ok: false; reason: 'error'; detail: string };

/**
 * Send a follow-up message into an existing session. A stale-token rejection
 * means someone else's turn slipped in between the tail read and this send —
 * reported as 'running' so the caller can 409 the same way.
 */
export async function sendEveFollowUp(
  config: EveConfig,
  sessionId: string,
  continuationToken: string,
  message: string
): Promise<FollowUpResult> {
  const response = await fetch(sessionUrl(config, `/${sessionId}`), {
    method: 'POST',
    headers: headers(config),
    body: JSON.stringify({ continuationToken, message }),
  });
  if (response.ok) return { ok: true };
  const detail = (await response.text()).slice(0, 300);
  if (response.status === 409 || response.status === 422 || /continuation/i.test(detail)) {
    return { ok: false, reason: 'running' };
  }
  return { ok: false, reason: 'error', detail: `HTTP ${response.status}: ${detail}` };
}
