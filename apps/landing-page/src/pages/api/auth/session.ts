// Session status endpoint
// Returns current auth state for client-side use

import type { APIRoute } from 'astro';
import { validateSession } from '@/lib/auth-session';
import type { AuthSession } from '@/lib/momence-oauth-types';

export const prerender = false;

export const GET: APIRoute = async ({ cookies, request }) => {
  console.log('[Session API] Session check requested');
  console.log('[Session API] Request headers cookie:', request.headers.get('cookie')?.substring(0, 100) + '...');

  try {
    const { session } = await validateSession(cookies);
    console.log('[Session API] Session result:', JSON.stringify(session));

    return new Response(JSON.stringify(session), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // Short cache - auth state changes frequently
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('[Session API] Error:', error);

    const errorSession: AuthSession = {
      isAuthenticated: false,
      user: null,
      expiresAt: null,
    };

    return new Response(JSON.stringify(errorSession), {
      status: 200, // Return 200 with unauthenticated state, not 500
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      },
    });
  }
};
