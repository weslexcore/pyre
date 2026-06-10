import { Resend } from 'resend';

let client: Resend | null = null;

// Lazy singleton — mirrors getRedis(). Returns null when unconfigured so callers
// can no-op gracefully (e.g. in local/dev without a Resend key).
export function getResend(): Resend | null {
  if (client) return client;

  const apiKey = import.meta.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[Resend] RESEND_API_KEY not configured');
    return null;
  }

  client = new Resend(apiKey);
  return client;
}
