import type { APIRoute } from 'astro';
import { verifyDecisionToken } from '@/lib/partner/decision-token';
import { applyDecision } from '@/lib/partner/verification';

export const prerender = false;

// One-click confirm/deny landing for partner verification email (modeled on
// /api/unsubscribe). GET is acceptable v1 risk for mail-scanner prefetch: the
// email goes only to the addressed partner contact and confirm/deny are
// distinct signed URLs. If prefetch ever mis-fires a decision, upgrade this to
// render a <form method="post"> button page instead of acting on GET.

function page(title: string, body: string, status: number): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Pyre — ${title}</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1a1a1a}h1{font-size:1.25rem}</style></head><body><h1>Pyre Sauna</h1><p>${body}</p></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('token');
  if (!token) return page('Invalid link', 'This link is missing its token.', 400);

  const verified = verifyDecisionToken(token);
  if (verified.status === 'expired') {
    return page(
      'Link expired',
      'This verification link has expired. If the customer still needs verifying, ask them to submit the form again — or reply to the original email and we’ll sort it out.',
      410
    );
  }
  if (verified.status === 'invalid') {
    return page(
      'Invalid link',
      'This verification link is invalid. Please use the buttons from the original email, or contact <a href="mailto:hello@pyresauna.com">hello@pyresauna.com</a>.',
      400
    );
  }

  try {
    const result = await applyDecision(verified.requestId, verified.action);

    switch (result.outcome) {
      case 'confirmed':
        return page(
          'Confirmed',
          'Confirmed — thanks! We’ve let them know their discount is live. Nothing else to do.',
          200
        );
      case 'denied':
        return page(
          'Noted',
          'Got it — we’ve marked them as not a member and let them know. Thanks for checking.',
          200
        );
      case 'already-handled':
        return page(
          'Already handled',
          `This request was already ${result.status === 'confirmed' ? 'confirmed' : 'resolved'} — nothing else to do.`,
          200
        );
      case 'not-found':
        return page('Not found', 'We couldn’t find this verification request.', 404);
    }
  } catch (error) {
    console.error('[Partner] Decision failed', error);
    return page(
      'Something went wrong',
      'Something went wrong on our end — please try the link again in a minute. If it keeps failing, reply to the original email.',
      500
    );
  }
};
