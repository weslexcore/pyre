// Server-side PostHog HogQL query client for admin analytics endpoints.
// Requires a personal API key with the Query Read scope (the public phc_
// project token cannot run queries) plus the numeric project id.
//
// PostHog runs personal-API-key queries on a shared, throttled ClickHouse pool:
// even trivial queries wait several seconds in its queue and intermittently
// come back 503 ("Queries are a little too busy right now") or 504 (max
// execution time). Callers should issue as few queries as possible per
// request and lean on the retry built in here.

const DEFAULT_HOST = 'https://us.posthog.com';

// HTTP statuses PostHog uses for transient query-pool pressure.
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const DEFAULT_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1500;

// process.env fallback: import.meta.env is inlined at build time, so values added
// to Vercel after the build only exist at runtime.
function getApiKey(): string | undefined {
  return import.meta.env.POSTHOG_PERSONAL_API_KEY ?? process.env.POSTHOG_PERSONAL_API_KEY;
}

function getProjectId(): string | undefined {
  return import.meta.env.POSTHOG_PROJECT_ID ?? process.env.POSTHOG_PROJECT_ID;
}

function getHost(): string {
  return import.meta.env.POSTHOG_HOST || process.env.POSTHOG_HOST || DEFAULT_HOST;
}

export function isPostHogQueryConfigured(): boolean {
  return Boolean(getApiKey() && getProjectId());
}

function requireConfig(): { apiKey: string; projectId: string } {
  const apiKey = getApiKey();
  const projectId = getProjectId();
  if (!apiKey || !projectId) {
    throw new Error('PostHog query API not configured');
  }
  return { apiKey, projectId };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('Aborted'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface QueryOptions {
  /** Bounds the whole call, retries included (e.g. AbortSignal.timeout(ms)). */
  signal?: AbortSignal;
  /** Extra attempts after a 429/502/503/504. Defaults to 2; pass 0 to disable. */
  retries?: number;
}

/** Run a HogQL query and return raw result rows. Throws if unconfigured or on API errors.
 * Transient 429/502/503/504 responses are retried with a short backoff unless
 * `signal` aborts first. Note HogQL caps result rows at 100 unless the query
 * carries an explicit LIMIT. */
export async function queryHogQL(query: string, options?: QueryOptions): Promise<unknown[][]> {
  const { apiKey, projectId } = requireConfig();
  const retries = options?.retries ?? DEFAULT_RETRIES;
  const signal = options?.signal;

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_BASE_DELAY_MS * attempt, signal);
    }
    const res = await fetch(`${getHost()}/api/projects/${projectId}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
      signal,
    });

    if (res.ok) {
      const json = (await res.json()) as { results?: unknown[][] };
      return json.results ?? [];
    }

    const body = await res.text().catch(() => '');
    lastError = new Error(`PostHog query failed (${res.status}): ${body.slice(0, 300)}`);
    if (!RETRYABLE_STATUSES.has(res.status)) break;
    // PostHog refuses to re-run a query that just failed identically three
    // times in a row, so keep hammering pointless — bail on that signal.
    if (body.includes('was not run again')) break;
  }
  throw lastError ?? new Error('PostHog query failed');
}

/** When each named event was last ingested, from PostHog's event-definition
 * registry (Postgres — no ClickHouse query, so it is cheap and unaffected by the
 * query-pool congestion). Events PostHog has never seen are absent from the map;
 * definitions without a recorded last_seen_at map to null. */
export async function getEventLastSeen(
  names: readonly string[],
  options?: { signal?: AbortSignal }
): Promise<Map<string, Date | null>> {
  const { apiKey, projectId } = requireConfig();
  const seen = new Map<string, Date | null>();
  const wanted = new Set(names);
  // The registry is small for this project; page through it rather than
  // issuing one search per event, which was observed to hang server-side.
  let next: string | null = `${getHost()}/api/projects/${projectId}/event_definitions/?limit=500`;
  while (next && seen.size < wanted.size) {
    const res: Response = await fetch(next, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: options?.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`PostHog event definitions failed (${res.status}): ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      next?: string | null;
      results?: Array<{ name: string; last_seen_at?: string | null }>;
    };
    for (const def of json.results ?? []) {
      if (!wanted.has(def.name)) continue;
      seen.set(def.name, def.last_seen_at ? new Date(def.last_seen_at) : null);
    }
    next = json.next ?? null;
  }
  return seen;
}
