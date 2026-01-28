// Token refresh endpoint
// Explicitly refresh access token using refresh token

import type { APIRoute } from 'astro';
import { getAuthTokens, setAuthTokens } from '@/lib/auth-cookies';
import { isTokenExpired, refreshAccessToken } from '@/lib/momence-oauth';

export const prerender = false;

export const POST: APIRoute = async ({ cookies }) => {
  const tokens = getAuthTokens(cookies);

  if (!tokens) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'not_authenticated',
      }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }

  // Check if refresh is actually needed
  if (!isTokenExpired(tokens.expiresAt)) {
    return new Response(
      JSON.stringify({
        success: true,
        refreshed: false,
        expiresAt: tokens.expiresAt,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }

  try {
    const newTokens = await refreshAccessToken(tokens.refreshToken);
    setAuthTokens(cookies, newTokens);

    return new Response(
      JSON.stringify({
        success: true,
        refreshed: true,
        expiresAt: newTokens.expiresAt,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('[Refresh API] Token refresh failed:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: 'refresh_failed',
      }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
};
