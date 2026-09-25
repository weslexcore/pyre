// The preamble every admin API route repeats, in one place: the JSON helper,
// the UUID check, and the gate-then-CSRF-then-content-type sequence. Grew up
// in the goals/boards routes; now shared by all of them. Server-only.

import type { APIRoute, AstroCookies } from 'astro';
import { type AdminGate, assertSameOrigin, requireAnyPage, requirePage } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import { json } from './json';

export { dbError, isUniqueViolation, isUuid, isUuidParam, JSON_HEADERS, json } from './json';

export type Db = NonNullable<ReturnType<typeof getDb>>;

/** A gate like requireAdmin/requireStaff: an AdminGate or a ready 401/403. */
export type GateFn = (cookies: AstroCookies) => Promise<AdminGate | Response>;

/** What a route gates on: one page, any of several, or a gate function. */
export type GateSpec = string | string[] | GateFn;

function gateOn(cookies: AstroCookies, spec: GateSpec) {
  if (typeof spec === 'function') return spec(cookies);
  return Array.isArray(spec) ? requireAnyPage(cookies, spec) : requirePage(cookies, spec);
}

/** Lowercased session email — the actor on every row and every event. */
export function sessionEmail(gate: AdminGate): string {
  return (gate.user.email ?? '').trim().toLowerCase();
}

/**
 * Gate plus same-origin check — the guard every cookie-authenticated
 * mutation needs before it touches anything.
 */
export async function gateMutation(
  cookies: AstroCookies,
  request: Request,
  spec: GateSpec
): Promise<AdminGate | Response> {
  const gate = await gateOn(cookies, spec);
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  return gate;
}

/**
 * The JSON body of a request: 415 unless it is application/json, 400 unless
 * it parses to a plain object.
 */
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | Response> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  return body as Record<string, unknown>;
}

export interface Mutation {
  gate: AdminGate;
  db: Db;
  /** Lowercased session email — the actor on every row and every event. */
  email: string;
  body: Record<string, unknown>;
}

/**
 * The whole mutation preamble: gate, same-origin, content type, storage, a
 * session email, and a parsed body. Returns a ready-to-return Response on
 * any failure, so a route reads `if (ready instanceof Response) return ready`
 * once instead of six times.
 */
export async function beginMutation(
  cookies: AstroCookies,
  request: Request,
  spec: GateSpec
): Promise<Mutation | Response> {
  const gate = await gateMutation(cookies, request, spec);
  if (gate instanceof Response) return gate;

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const email = sessionEmail(gate);
  if (!email) return json({ error: 'Session has no email' }, 400);

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  return { gate, db, email, body };
}

/** The same, for a DELETE — no body, but the same gate and CSRF guard. */
export async function beginDelete(
  cookies: AstroCookies,
  request: Request,
  spec: GateSpec
): Promise<Omit<Mutation, 'body'> | Response> {
  const gate = await gateMutation(cookies, request, spec);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const email = sessionEmail(gate);
  if (!email) return json({ error: 'Session has no email' }, 400);

  return { gate, db, email };
}

/** The read preamble: gate plus storage. */
export async function beginRead(
  cookies: AstroCookies,
  spec: GateSpec
): Promise<{ gate: AdminGate; db: Db } | Response> {
  const gate = await gateOn(cookies, spec);
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
