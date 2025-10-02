import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { token } = await request.json();

    if (!token) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing Turnstile token',
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }

    const secretKey = import.meta.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;

    if (!secretKey) {
      console.error('CLOUDFLARE_TURNSTILE_SECRET_KEY not configured');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Server configuration error',
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }

    // Validate token with Cloudflare Turnstile
    const verifyResponse = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          secret: secretKey,
          response: token,
        }),
      }
    );

    const verifyResult = await verifyResponse.json();

    if (verifyResult.success) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Turnstile verification successful',
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    } else {
      console.error('Turnstile verification failed:', verifyResult['error-codes']);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Verification failed',
          details: verifyResult['error-codes'] || [],
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }
  } catch (error) {
    console.error('Turnstile verification error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Internal server error',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
};

export const prerender = false;
