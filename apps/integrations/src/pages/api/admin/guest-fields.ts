// The question list behind every guest profile (/admin/guests/fields).
//   GET                          — every field, archived included, in order;
//                                  with answer counts for anyone who may manage
//   POST   { label, kind, … }    — add a field, placed last
//   PATCH  { key, …changes }     — rename, re-option, move section, roster
//                                  flag, archive / restore
//   PATCH  { order: [keys] }     — re-order
//   DELETE ?key=                 — remove a field nobody has answered
//
// Reading is open to anyone with the page (the profile form needs it).
// Everything else needs guests:manage: changing the questions changes what
// every profile means, which is a decision for whoever runs the desk, not
// whoever is on it. Keys and kinds are permanent — answers hang off them —
// so a mistake is fixed by archiving and adding, never by mutating in place.

import type { APIRoute } from 'astro';
import { hasGuestsManage } from '@/components/admin/adminTools';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import type { GuestProfileFieldRow } from '@/lib/db';
import { getDb } from '@/lib/db';
import { countAnswers, loadFields } from '@/lib/guests/store';
import { GUESTS_PAGE } from '@/lib/guests/types';
import { normalizeFieldCreate, normalizeFieldPatch, normalizeOrder } from '@/lib/guests/validate';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

const emailOf = (gate: { user: { email: string } }): string =>
  (gate.user.email ?? '').trim().toLowerCase();

async function gateMutation(
  cookies: Parameters<APIRoute>[0]['cookies'],
  request: Request
): Promise<{ email: string } | Response> {
  const gate = await requirePage(cookies, GUESTS_PAGE);
  if (gate instanceof Response) return gate;
  if (!hasGuestsManage(gate.access)) {
    return json({ error: 'Changing the profile fields needs the guests:manage permission' }, 403);
  }
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  return { email: emailOf(gate) };
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | Response> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
}

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requirePage(cookies, GUESTS_PAGE);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const canManage = hasGuestsManage(gate.access);
  const fields = await loadFields(db);
  const answers = canManage ? await countAnswers(db) : {};

  return json({ fields, answers, canManage });
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await gateMutation(cookies, request);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const normalized = normalizeFieldCreate(body);
  if (!normalized.ok) return json({ error: normalized.error }, 400);

  // Place it last, after every field that already has a position.
  const { data: last } = await db
    .from('guest_profile_fields')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = last ? (last.sort_order as number) + 10 : 10;

  const { data, error } = await db
    .from('guest_profile_fields')
    .insert({
      ...normalized.value,
      sort_order: sortOrder,
      created_by: gate.email,
      updated_by: gate.email,
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') {
      return json({ error: `A field with the key "${normalized.value.key}" already exists` }, 409);
    }
    return json({ error: error.message }, 500);
  }

  return json({ field: data as GuestProfileFieldRow }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const gate = await gateMutation(cookies, request);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  // A re-order: the complete list in its new order. Fields left out keep
  // their old position, so a stale client can't drop one off the end.
  if ('order' in body) {
    const fields = await loadFields(db);
    const order = normalizeOrder(
      body.order,
      fields.map((f) => f.key)
    );
    if (!order) return json({ error: 'order must list field keys' }, 400);

    const now = new Date().toISOString();
    for (const [index, key] of order.entries()) {
      const { error } = await db
        .from('guest_profile_fields')
        .update({ sort_order: (index + 1) * 10, updated_by: gate.email, updated_at: now })
        .eq('key', key);
      if (error) return json({ error: error.message }, 500);
    }
    return json({ fields: await loadFields(db) });
  }

  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (!KEY_RE.test(key)) return json({ error: 'key is required' }, 400);

  const { data: current, error: readError } = await db
    .from('guest_profile_fields')
    .select('*')
    .eq('key', key)
    .maybeSingle();
  if (readError) return json({ error: readError.message }, 500);
  const existing = (current as GuestProfileFieldRow | null) ?? null;
  if (!existing) return json({ error: 'Field not found' }, 404);

  const normalized = normalizeFieldPatch(body, existing);
  if (!normalized.ok) return json({ error: normalized.error }, 400);

  const { data, error } = await db
    .from('guest_profile_fields')
    .update({ ...normalized.value, updated_by: gate.email, updated_at: new Date().toISOString() })
    .eq('key', key)
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({ field: data as GuestProfileFieldRow });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const gate = await gateMutation(cookies, request);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const key = (url.searchParams.get('key') ?? '').trim();
  if (!KEY_RE.test(key)) return json({ error: 'key is required' }, 400);

  // Deleting a question must never delete answers. A field with answers is
  // archived instead, which keeps them readable on the profiles that hold them.
  const answers = await countAnswers(db);
  const inUse = answers[key] ?? 0;
  if (inUse > 0) {
    return json(
      {
        error: `${inUse} profile${inUse === 1 ? ' has' : 's have'} an answer to this field. Archive it instead — the answers stay readable.`,
      },
      409
    );
  }

  const { error } = await db.from('guest_profile_fields').delete().eq('key', key);
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true });
};
