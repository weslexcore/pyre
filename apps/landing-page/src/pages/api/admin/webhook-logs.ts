import type { APIRoute } from 'astro';
import { isAdminEmail } from '@/lib/admin';
import { validateSession } from '@/lib/auth-session';
import { getExecution, getRecentExecutions } from '@/lib/webhooks/execution-store';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export const GET: APIRoute = async ({ cookies, url }) => {
  const { session } = await validateSession(cookies);

  if (!session.isAuthenticated || !session.user) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: JSON_HEADERS,
    });
  }

  if (!session.user.email || !isAdminEmail(session.user.email)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: JSON_HEADERS,
    });
  }

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
