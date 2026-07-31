import type { APIRoute } from 'astro';
import { verifyTurnstileToken } from '../../lib/turnstile';

export const POST: APIRoute = async ({ request }) => {
  const jsonResponse = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  try {
    const { token } = await request.json();

    if (!token) {
      return jsonResponse(400, { success: false, error: 'Missing Turnstile token' });
    }

    if (!import.meta.env.CLOUDFLARE_TURNSTILE_SECRET_KEY) {
      return jsonResponse(500, { success: false, error: 'Server configuration error' });
    }

    const success = await verifyTurnstileToken(token);
    if (success) {
      return jsonResponse(200, { success: true, message: 'Turnstile verification successful' });
    }
    return jsonResponse(400, { success: false, error: 'Verification failed' });
  } catch (error) {
    console.error('Turnstile verification error:', error);
    return jsonResponse(500, { success: false, error: 'Internal server error' });
  }
};

export const prerender = false;
