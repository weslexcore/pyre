// Webhook execution log for the admin dashboard, ported from the landing-page
// admin. Reads the shared Upstash execution store via @pyre/webhook-core.

import { getExecution, getRecentExecutions } from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import { requirePage } from '@/lib/auth/admin';
import { json } from '@/lib/http/route';

export const GET: APIRoute = async ({ cookies, url }) => {
  const gate = await requirePage(cookies, '/admin/webhooks');
  if (gate instanceof Response) return gate;

  // Single record detail
  const id = url.searchParams.get('id');
  if (id) {
    const record = await getExecution(id);
    if (!record) {
      return json({ error: 'Not found' }, 404);
    }
    return json(record);
  }

  // Paginated list
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? '0'), 0);

  const { records, total } = await getRecentExecutions(limit, offset);

  return json({ records, total, limit, offset });
};
