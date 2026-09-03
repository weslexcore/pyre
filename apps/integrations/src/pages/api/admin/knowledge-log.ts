// The knowledge assistant's audit log, for admins: every question staff
// asked (/admin/ask), the access the assistant had on their behalf, the
// tools it called, and the answer. Rows are written by pyre-agents itself
// (public.knowledge_queries); this route only reads them, newest first,
// with an optional asker filter and a before-cursor for paging.

import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import { trailFromJson } from '@/lib/knowledge/trail';
import { getPeopleNames } from '@/lib/sops/people';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 200;

export interface KnowledgeQueryRow {
  id: string;
  session_id: string;
  turn_id: string;
  asked_by: string;
  viewer_scope: {
    role?: string;
    email?: string;
    shiftNotes?: 'all' | 'mine' | null;
    incidents?: 'all' | 'mine' | null;
    water?: boolean;
  };
  question: string;
  answer: string | null;
  tool_calls: Array<{ tool: string; input: Record<string, unknown> }>;
  trail: unknown;
  status: 'pending' | 'answered' | 'failed' | 'cancelled';
  error: string | null;
  asked_at: string;
  answered_at: string | null;
}

export const GET: APIRoute = async ({ cookies, request }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const url = new URL(request.url);
  const limitParam = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;
  const before = url.searchParams.get('before');
  const asker = (url.searchParams.get('asker') ?? '').trim().toLowerCase();

  let query = db
    .from('knowledge_queries')
    .select(
      'id, session_id, turn_id, asked_by, viewer_scope, question, answer, tool_calls, trail, status, error, asked_at, answered_at'
    )
    .order('asked_at', { ascending: false })
    .limit(limit + 1);
  if (before && !Number.isNaN(Date.parse(before))) query = query.lt('asked_at', before);
  if (asker) query = query.eq('asked_by', asker);

  const { data, error } = await query;
  if (error) return json({ error: error.message }, 500);

  const rows = (data ?? []) as KnowledgeQueryRow[];
  const page = rows.slice(0, limit).map((row) => ({ ...row, trail: trailFromJson(row.trail) }));
  const people = await getPeopleNames(page.map((r) => r.asked_by));

  // Everyone who has asked, for the filter — distinct askers over the log.
  const { data: askers, error: askersError } = await db
    .from('knowledge_queries')
    .select('asked_by')
    .neq('asked_by', '')
    .order('asked_by');
  if (askersError) return json({ error: askersError.message }, 500);
  const askerEmails = [...new Set((askers ?? []).map((r) => (r as { asked_by: string }).asked_by))];
  const askerNames = await getPeopleNames(askerEmails);

  return json({
    rows: page,
    hasMore: rows.length > limit,
    people: { ...askerNames, ...people },
    askers: askerEmails,
  });
};
