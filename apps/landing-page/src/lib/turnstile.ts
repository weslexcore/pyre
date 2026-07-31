// Server-side Cloudflare Turnstile verification, shared by the API routes that
// accept form submissions (api/verify-turnstile.ts, api/partner-verification.ts).

export async function verifyTurnstileToken(token: string): Promise<boolean> {
  const secretKey = import.meta.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    console.error('CLOUDFLARE_TURNSTILE_SECRET_KEY not configured');
    return false;
  }

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: secretKey, response: token }),
    });
    const result = await response.json();
    if (!result.success) {
      console.error('Turnstile verification failed:', result['error-codes']);
    }
    return result.success === true;
  } catch (error) {
    console.error('Turnstile verification error:', error);
    return false;
  }
}
