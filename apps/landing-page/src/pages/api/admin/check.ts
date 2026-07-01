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
    return new Response(
      JSON.stringify({
        error: 'Forbidden',
        detected: {
          email: session.user.email || null,
          userId: session.user.id || null,
        },
      }),
      {
        status: 403,
        headers: JSON_HEADERS,
      }
    );
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_HEADERS });
};
