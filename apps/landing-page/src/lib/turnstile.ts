// Server-side Cloudflare Turnstile verification, shared by the API routes that
// accept form submissions (api/verify-turnstile.ts, api/partner-verification.ts).

const DEFAULT_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Cloudflare's siteverify endpoint. Overridable with
 * CLOUDFLARE_TURNSTILE_VERIFY_URL so the E2E suite can run these routes for
 * real against its mock server (e2e/env.ts) instead of Cloudflare.
 */
function siteverifyUrl(): string {
  const fromImportMeta = import.meta.env.CLOUDFLARE_TURNSTILE_VERIFY_URL as string | undefined;
  const fromProcess =
    typeof process !== 'undefined' ? process.env.CLOUDFLARE_TURNSTILE_VERIFY_URL : undefined;
  return fromImportMeta || fromProcess || DEFAULT_SITEVERIFY_URL;
}

export async function verifyTurnstileToken(token: string): Promise<boolean> {
  const secretKey = import.meta.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    console.error('CLOUDFLARE_TURNSTILE_SECRET_KEY not configured');
    return false;
  }

  try {
    const response = await fetch(siteverifyUrl(), {
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
