// The partner-membership verification queue behind /admin/partners: list every
// request with its status and audit trail, and act on one manually when the
// email round-trip isn't enough — the partner never clicked, they told us over
// the phone, or a confirmed member needs their discount pulled.
//
// Every action delegates to applyDecision/resendVerificationRequest so the
// Momence work, the race guards, and the customer emails stay in one place;
// this route only supplies the actor so the audit trail can tell an admin
// action apart from a partner's one-click.
//
// There is no DELETE: verification rows are the audit trail.

import type { APIRoute } from 'astro';
import { PARTNERS_MANAGE } from '@/components/admin/adminTools';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import { getDb, type PartnerVerificationRow } from '@/lib/db';
import {
  applyDecision,
  type DecisionActor,
  resendVerificationRequest,
} from '@/lib/partner/verification';

export const prerender = false;

const PAGE = '/admin/partners';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const TABLE = 'partner_verifications';
const STATUSES = ['pending', 'confirmed', 'denied', 'expired', 'revoked'] as const;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT)
  );

  let query = db.from(TABLE).select('*').order('created_at', { ascending: false }).limit(limit);

  const partner = url.searchParams.get('partner');
  if (partner) query = query.eq('partner_slug', partner);

  const status = url.searchParams.get('status');
  if (status) {
    const wanted = status
      .split(',')
      .map((s) => s.trim())
      .filter((s) => (STATUSES as readonly string[]).includes(s));
    if (wanted.length > 0) query = query.in('status', wanted);
  }

  const q = url.searchParams.get('q')?.trim();
  if (q) {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    query = query.or(
      `customer_email.ilike.${like},customer_first_name.ilike.${like},customer_last_name.ilike.${like}`
    );
  }

  // Cursor for "load older" — created_at is the sort key.
  const before = url.searchParams.get('before');
  if (before) query = query.lt('created_at', before);

  const { data, error } = await query;
  if (error) return json({ error: error.message }, 500);

  // Status tallies across the whole table, not the filtered page, so the
  // filter pills can show totals. Cheap at this table's size (hundreds of
  // rows); if it ever gets big this becomes a Postgres aggregate.
  const { data: allStatuses } = await db.from(TABLE).select('status');
  const counts: Record<string, number> = {};
  for (const row of (allStatuses ?? []) as { status: string }[]) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }

  return json({
    requests: (data ?? []) as PartnerVerificationRow[],
    counts,
    canManage: gate.access.isAdmin || gate.access.pages.includes(PARTNERS_MANAGE),
  });
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, PAGE);
  if (gate instanceof Response) return gate;
  if (!gate.access.isAdmin && !gate.access.pages.includes(PARTNERS_MANAGE)) {
    return json({ error: 'Forbidden' }, 403);
  }
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Expected application/json' }, 415);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const id = String(body.id ?? '');
  if (!id) return json({ error: 'Missing id' }, 400);

  const action = String(body.action ?? '');
  const actor: DecisionActor = { kind: 'admin', email: (gate.user.email ?? '').toLowerCase() };

  try {
    if (action === 'resend') {
      const result = await resendVerificationRequest(id, actor);
      switch (result.outcome) {
        case 'sent':
          return json({ ok: true, results: result.results });
        case 'not-found':
          return json({ error: 'No such request' }, 404);
        case 'partner-missing':
          return json({ error: 'This request’s partner no longer exists' }, 404);
        case 'not-pending':
          return json({ error: `Already ${result.status} — nothing to resend` }, 409);
        case 'no-contacts':
          return json({ error: 'This partner has no contact addresses' }, 400);
        case 'throttled':
          return json(
            {
              error: `Just sent — try again in ${result.retryAfterSeconds}s`,
              retryAfterSeconds: result.retryAfterSeconds,
            },
            429
          );
        case 'send-failed':
          return json({ error: 'No contact could be emailed', results: result.results }, 502);
      }
    }

    if (action !== 'confirm' && action !== 'deny') {
      return json({ error: `Unknown action: ${action || '(none)'}` }, 400);
    }

    const result = await applyDecision(id, action, actor);
    switch (result.outcome) {
      case 'confirmed':
      case 'denied':
        return json({ ok: true, outcome: result.outcome });
      case 'not-found':
        return json({ error: 'No such request' }, 404);
      case 'partner-missing':
        return json({ error: 'This request’s partner no longer exists' }, 404);
      case 'already-handled':
        return json({ error: `Already ${result.status}` }, 409);
    }
  } catch (error) {
    // The most likely cause is a Momence tag that doesn't exist — surface the
    // real message, it names the tag and tells you to create it.
    console.error('[partner-requests] Action failed', error);
    return json({ error: error instanceof Error ? error.message : 'Action failed' }, 500);
  }
};
