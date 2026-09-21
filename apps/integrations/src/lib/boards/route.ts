// The preamble every goals/boards API route repeats, in one place: the JSON
// helper, the UUID check, and the gate-then-CSRF-then-content-type sequence
// from shift-notes.ts. Server-only.
//
// Goals and boards are one tool — a task is a card, a goal is what a board
// is for — so their routes share this rather than each carrying its own copy.

import type { APIRoute, AstroCookies } from 'astro';
import { type AdminGate, assertSameOrigin, requireAnyPage, requirePage } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';

export const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidParam(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export type Db = NonNullable<ReturnType<typeof getDb>>;

/**
 * Gate on one page, or on any of several. Every goals/boards route gates on
 * /admin/boards today; the list form stays for a route that spans tools.
 */
function gateOn(cookies: AstroCookies, page: string | string[]) {
  return Array.isArray(page) ? requireAnyPage(cookies, page) : requirePage(cookies, page);
}

export interface Mutation {
  gate: AdminGate;
  db: Db;
  /** Lowercased session email — the actor on every row and every event. */
  email: string;
  body: Record<string, unknown>;
}

/**
 * The whole mutation preamble: page gate, same-origin, content type, storage,
 * a session email, and a parsed body. Returns a ready-to-return Response on
 * any failure, so a route reads `if (ready instanceof Response) return ready`
 * once instead of six times.
 */
export async function beginMutation(
  cookies: AstroCookies,
  request: Request,
  page: string | string[]
): Promise<Mutation | Response> {
  const gate = await gateOn(cookies, page);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const email = (gate.user.email ?? '').trim().toLowerCase();
  if (!email) return json({ error: 'Session has no email' }, 400);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  return { gate, db, email, body };
}

/** The same, for a DELETE — no body, but the same gate and CSRF guard. */
export async function beginDelete(
  cookies: AstroCookies,
  request: Request,
  page: string | string[]
): Promise<Omit<Mutation, 'body'> | Response> {
  const gate = await gateOn(cookies, page);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const email = (gate.user.email ?? '').trim().toLowerCase();
  if (!email) return json({ error: 'Session has no email' }, 400);

  return { gate, db, email };
}

/** The read preamble: page gate plus storage. */
export async function beginRead(
  cookies: AstroCookies,
  page: string | string[]
): Promise<{ gate: AdminGate; db: Db } | Response> {
  const gate = await gateOn(cookies, page);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  return { gate, db };
}

/** Turns a thrown store error into the 500 the islands expect. */
export function storeError(scope: string, e: unknown): Response {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`[${scope}] read failed:`, message);
  return json({ error: message }, 500);
}

export type { APIRoute };
