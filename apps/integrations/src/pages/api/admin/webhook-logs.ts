// Webhook execution log for the admin dashboard, ported from the landing-page
// admin. Reads the shared Upstash execution store via @pyre/webhook-core.

import { getExecution, getRecentExecutions } from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/auth/admin';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  // Single record detail
  const id = url.searchParams.get('id');
  if (id) {
    const record = await getExecution(id);
    if (!record) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: JSON_HEADERS,
      });
    }
    return new Response(JSON.stringify(record), { status: 200, headers: JSON_HEADERS });
  }

  // Paginated list
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? '0'), 0);

  const { records, total } = await getRecentExecutions(limit, offset);

  return new Response(JSON.stringify({ records, total, limit, offset }), {
    status: 200,
    headers: JSON_HEADERS,
  });
};
