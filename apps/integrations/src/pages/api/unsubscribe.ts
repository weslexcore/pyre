import type { APIRoute } from 'astro';
import { suppressEmail } from '@/lib/email/suppression';
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe-token';

export const prerender = false;

// Canonical unsubscribe endpoint for engine-sent marketing email.
// GET  — human clicking the footer link (returns a small confirmation page).
// POST — RFC 8058 one-click unsubscribe fired by mail clients via the
//        List-Unsubscribe-Post header (must succeed without any UI).
// The token is HMAC-signed (lib/email/unsubscribe-token.ts) so the link works
// with zero per-recipient state and can't be forged for someone else's address.

async function handleUnsubscribe(url: URL): Promise<{ ok: boolean; email?: string }> {
  const token = url.searchParams.get('token');
  if (!token) return { ok: false };

  const email = verifyUnsubscribeToken(token);
  if (!email) return { ok: false };

  await suppressEmail({ email, reason: 'unsubscribe', source: 'unsubscribe-link' });
  return { ok: true, email };
}

function confirmationPage(ok: boolean, email?: string): Response {
  const body = ok
    ? `<p>You've been unsubscribed${email ? ` (${escapeHtml(email)})` : ''}. You'll no longer receive marketing email from Pyre. Booking confirmations are unaffected.</p>`
    : `<p>This unsubscribe link is invalid or has expired. Please use the link from a recent email, or contact <a href="mailto:hello@pyresauna.com">hello@pyresauna.com</a>.</p>`;

  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Pyre — Unsubscribe</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1a1a1a}h1{font-size:1.25rem}</style></head><body><h1>Pyre Sauna</h1>${body}</body></html>`,
    { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export const GET: APIRoute = async ({ url }) => {
  try {
    const result = await handleUnsubscribe(url);
    return confirmationPage(result.ok, result.email);
  } catch (error) {
    console.error('[Unsubscribe] Failed', error);
    return confirmationPage(false);
  }
};

export const POST: APIRoute = async ({ url }) => {
  try {
    const result = await handleUnsubscribe(url);
    return new Response(null, { status: result.ok ? 200 : 400 });
  } catch (error) {
    console.error('[Unsubscribe] One-click failed', error);
    return new Response(null, { status: 500 });
  }
};
