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
//   POST /__override          { method?, path, status?, json? } — answer that
//                             route with a canned response instead
//   POST /__reset             drop overrides and the request log
// Tests drive it with `mockServerClient(url)`.

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
  const overrides = new Map<string, MockOverride>();
  const requests: RecordedRequest[] = [];

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
    if (url.pathname === '/__reset' && method === 'POST') {
      overrides.clear();
      requests.length = 0;
      return send({ json: { ok: true } });
    }
    if (url.pathname === '/__override' && method === 'POST') {
      const override = body as MockOverride;
      if (!override?.path) return send({ status: 400, json: { error: 'path is required' } });
      overrides.set(overrideKey(override.method, override.path), override);
      return send({ json: { ok: true } });
    }

    // -- App routes ----------------------------------------------------------
    requests.push({
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body,
    });
    if (options.log) console.log(`[mock] ${method} ${url.pathname}`);

    const override = overrides.get(overrideKey(method, url.pathname));
    if (override) return send({ status: override.status ?? 200, json: override.json ?? {} });

    const route = findRoute(method, url.pathname);
    if (!route)
      return send({ status: 404, json: { error: `No mock for ${method} ${url.pathname}` } });

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
  const post = async (path: string, body?: unknown) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Mock server ${path} returned ${res.status}`);
  };

  return {
    override: (override: MockOverride) => post('/__override', override),
    reset: () => post('/__reset'),
    requests: async (): Promise<RecordedRequest[]> => {
      const res = await fetch(`${baseUrl}/__requests`);
      return (await res.json()) as RecordedRequest[];
    },
  };
}
