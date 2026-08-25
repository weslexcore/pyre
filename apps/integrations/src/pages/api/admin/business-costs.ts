// CRUD for admin-entered operating costs (business_costs table), backing the
// costs manager on /admin/business: GET lists every definition, POST creates
// one, PUT rewrites one by id, DELETE removes one. The overview API folds
// these into daily profit math (lib/business/costs.ts).
//
// Admin-only like the rest of /admin/business — costs plus revenue are the
// whole P&L. Mutations are CSRF-guarded in-route via assertSameOrigin plus
// the JSON content-type requirement (global checkOrigin stays off for the
// Mailchimp webhook; see astro.config.mjs).

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireAdmin } from '@/lib/auth/admin';
import { parseCostInput } from '@/lib/business/validate';
import { type BusinessCostRow, getDb } from '@/lib/db';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export interface BusinessCostsPayload {
  costs: BusinessCostRow[];
}

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  // The whole table every time — it's a handful of definitions, and the
  // manager UI groups them client-side.
  const { data, error } = await db.from('business_costs').select('*').order('kind').order('name');
  if (error) return json({ error: error.message }, 500);

  const payload: BusinessCostsPayload = { costs: (data ?? []) as BusinessCostRow[] };
  return json(payload);
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = parseCostInput(body);
  if ('error' in parsed) return json({ error: parsed.error }, 400);

  const { data, error } = await db
    .from('business_costs')
    .insert({
      ...parsed.record,
      // Always the authenticated session's email — never trusted from the body.
      created_by: gate.user.email ?? '',
    })
    .select('*')
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({ cost: data as BusinessCostRow }, 201);
};

export const PUT: APIRoute = async ({ cookies, request, url }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = parseCostInput(body);
  if ('error' in parsed) return json({ error: parsed.error }, 400);

  const { data, error } = await db
    .from('business_costs')
    .update(parsed.record)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: 'Cost not found' }, 404);

  return json({ cost: data as BusinessCostRow });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400);

  const { data, error } = await db
    .from('business_costs')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: 'Cost not found' }, 404);

  return json({ ok: true });
};
