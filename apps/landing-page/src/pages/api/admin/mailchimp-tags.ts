import { listTags } from '@pyre/webhook-core';
import type { APIRoute } from 'astro';
import { isAdminEmail } from '@/lib/admin';
import { validateSession } from '@/lib/auth-session';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export const GET: APIRoute = async ({ cookies }) => {
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

  try {
    const tags = await listTags();
    tags.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return new Response(JSON.stringify({ tags }), { status: 200, headers: JSON_HEADERS });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
};
