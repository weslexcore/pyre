// A tiny HTTP server that plays an app's upstream APIs during E2E runs.
//
// Browser-side calls are stubbed with page.route, but calls the app's *server*
// makes (SSR pages, API routes proxying a third party) never pass through the
// browser. Pointing the app's upstream base URLs at this server instead lets
// that server code run for real against fixture data.
//
// Besides the app's routes it serves a small control API:
//   GET  /__health            readiness probe for Playwright's webServer
//   GET  /__requests          every request received since the last reset
//   POST /__override          { method?, path, status?, json?, bodyIncludes?,
//                             times? } — answer that route with a canned
//                             response instead; answers { id }
//   DELETE /__override?id=    drop one override
//   GET  /__unexpected        requests no route or override answered
//   DELETE /__unexpected      clear that list
//   POST /__reset             drop overrides and the request log
// Tests drive it with `mockServerClient(url)`.
//
// An override can be scoped so parallel tests never see each other's: give it
// `bodyIncludes` (a string only this test's request body contains, such as its
// unique email or entity id) and/or `times` (answer that many requests, then
// stop). Without either it answers every matching request until removed.

import { createServer, type IncomingMessage, type Server } from 'node:http';

export interface MockRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  /** Parsed JSON when the body is JSON, the raw string otherwise, else undefined. */
  body: unknown;
}

export interface MockResponse {
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

export type MockHandler = (request: MockRequest) => MockResponse | Promise<MockResponse>;

export interface MockRoute {
  /** Defaults to GET. */
  method?: string;
  /** Exact path, or a RegExp tested against the path. */
  path: string | RegExp;
  handler: MockHandler;
}

export interface MockServerOptions {
  port: number;
  routes: MockRoute[];
  /** Log each request to stdout (visible with DEBUG=pw:webserver). */
  log?: boolean;
}

export interface MockOverride {
  method?: string;
  path: string;
  status?: number;
  json?: unknown;
  /** Only requests whose path, query or body contains this string. */
  bodyIncludes?: string;
  /** Answer this many matching requests, then stand down. */
  times?: number;
}

interface StoredOverride extends MockOverride {
  id: string;
  remaining: number;
}

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function overrideKey(method: string | undefined, path: string): string {
  return `${(method ?? 'GET').toUpperCase()} ${path}`;
}

export function createMockServer(options: MockServerOptions) {
  // Newest first, so a scoped override wins over an older blanket one.
  let overrides: StoredOverride[] = [];
  let overrideSeq = 0;
  const requests: RecordedRequest[] = [];
  const unexpected: RecordedRequest[] = [];

  const findOverride = (method: string, path: string, haystack: string) =>
    overrides.find(
      (o) =>
        o.remaining > 0 &&
        overrideKey(o.method, o.path) === overrideKey(method, path) &&
        (o.bodyIncludes === undefined || haystack.includes(o.bodyIncludes))
    );

  const findRoute = (method: string, path: string) =>
    options.routes.find(
      (route) =>
        (route.method ?? 'GET').toUpperCase() === method &&
        (typeof route.path === 'string' ? route.path === path : route.path.test(path))
    );

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${options.port}`);
    const method = (req.method ?? 'GET').toUpperCase();
    const body = await readBody(req);

    const send = ({ status = 200, json, text, headers = {} }: MockResponse) => {
      if (json !== undefined) {
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
        res.end(JSON.stringify(json));
      } else {
        res.writeHead(status, { 'Content-Type': 'text/plain', ...headers });
        res.end(text ?? '');
      }
    };

    // -- Control API ---------------------------------------------------------
    if (url.pathname === '/__health') return send({ json: { ok: true } });
    if (url.pathname === '/__requests') return send({ json: requests });
    if (url.pathname === '/__unexpected') {
      if (method === 'DELETE') unexpected.length = 0;
      return send({ json: unexpected });
    }
    if (url.pathname === '/__reset' && method === 'POST') {
      overrides = [];
      requests.length = 0;
      return send({ json: { ok: true } });
    }
    if (url.pathname === '/__override' && method === 'DELETE') {
      const id = url.searchParams.get('id');
      overrides = overrides.filter((o) => o.id !== id);
      return send({ json: { ok: true } });
    }
    if (url.pathname === '/__override' && method === 'POST') {
      const override = body as MockOverride;
      if (!override?.path) return send({ status: 400, json: { error: 'path is required' } });
      const scoped = override.bodyIncludes !== undefined || override.times !== undefined;
      // An unscoped override replaces the last one for its route, as before.
      if (!scoped) {
        const key = overrideKey(override.method, override.path);
        overrides = overrides.filter(
          (o) =>
            overrideKey(o.method, o.path) !== key ||
            o.bodyIncludes !== undefined ||
            o.times !== undefined
        );
      }
      const id = `o${++overrideSeq}`;
      overrides.unshift({ ...override, id, remaining: override.times ?? Number.POSITIVE_INFINITY });
      return send({ json: { ok: true, id } });
    }

    // -- App routes ----------------------------------------------------------
    requests.push({
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body,
    });
    if (options.log) console.log(`[mock] ${method} ${url.pathname}`);

    const haystack = `${url.pathname}${url.search} ${
      typeof body === 'string' ? body : JSON.stringify(body ?? '')
    }`;
    const override = findOverride(method, url.pathname, haystack);
    if (override) {
      override.remaining -= 1;
      return send({ status: override.status ?? 200, json: override.json ?? {} });
    }

    const route = findRoute(method, url.pathname);
    if (!route) {
      unexpected.push(requests[requests.length - 1] as RecordedRequest);
      console.error(`[mock] unexpected ${method} ${url.pathname}`);
      return send({ status: 404, json: { error: `No mock for ${method} ${url.pathname}` } });
    }

    try {
      send(
        await route.handler({
          method,
          path: url.pathname,
          query: url.searchParams,
          headers: req.headers,
          body,
        })
      );
    } catch (error) {
      console.error('[mock] handler failed', error);
      send({ status: 500, json: { error: String(error) } });
    }
  });

  return {
    url: `http://localhost:${options.port}`,
    start: () =>
      new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port, () => resolve());
      }),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * Start a mock server as a standalone process (the way Playwright's webServer
 * runs it) and shut it down cleanly when Playwright stops it.
 */
export async function runMockServer(options: MockServerOptions): Promise<void> {
  const mock = createMockServer(options);
  await mock.start();
  console.log(`[mock] listening on ${mock.url}`);
  const shutdown = () => {
    void mock.stop().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/** Drive a running mock server's control API from a test. */
export function mockServerClient(baseUrl: string) {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Mock server ${method} ${path} returned ${res.status}`);
    return res.json() as Promise<unknown>;
  };

  return {
    /** Answer a route with a canned response. Resolves to the override's id. */
    override: async (override: MockOverride): Promise<string> =>
      ((await call('POST', '/__override', override)) as { id: string }).id,
    removeOverride: async (id: string): Promise<void> => {
      await call('DELETE', `/__override?id=${encodeURIComponent(id)}`);
    },
    reset: async (): Promise<void> => {
      await call('POST', '/__reset');
    },
    /** Requests no route or override answered (each got a 404). */
    unexpected: async (): Promise<RecordedRequest[]> =>
      (await call('GET', '/__unexpected')) as RecordedRequest[],
    clearUnexpected: async (): Promise<void> => {
      await call('DELETE', '/__unexpected');
    },
    requests: async (): Promise<RecordedRequest[]> => {
      const res = await fetch(`${baseUrl}/__requests`);
      return (await res.json()) as RecordedRequest[];
    },
  };
}
