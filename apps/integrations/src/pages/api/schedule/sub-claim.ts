import type { APIRoute } from 'astro';
import { getDb } from '@/lib/db';
import { claimSubRequest } from '@/lib/schedule/sub';
import { verifySubClaimToken } from '@/lib/schedule/sub-token';

export const prerender = false;

// One-click "I'll take this shift" landing for sub-request email (modeled on
// /api/partner/decision). GET is acceptable v1 risk for mail-scanner
// prefetch: each link goes only to the addressed teammate, claiming is
// idempotent-per-request (open -> claimed once), and a mis-fired claim is
// visible on the board and fixable by a manager in one click. If prefetch
// ever becomes a problem, upgrade this to a <form method="post"> button page.

function page(title: string, body: string, status: number): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Pyre — ${title}</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1a1a1a}h1{font-size:1.25rem}</style></head><body><h1>Pyre Sauna</h1><p>${body}</p></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('token');
  if (!token) return page('Invalid link', 'This link is missing its token.', 400);

  const verified = verifySubClaimToken(token);
  if (verified.status === 'expired') {
    return page(
      'Link expired',
      'This claim link has expired. Check the schedule board — if the shift still needs cover, a manager can put you on it.',
      410
    );
  }
  if (verified.status === 'invalid') {
    return page(
      'Invalid link',
      'This claim link is invalid. Please use the button from the original email, or check the schedule board.',
      400
    );
  }

  const db = getDb();
  if (!db) {
    return page(
      'Something went wrong',
      'Storage is unavailable — please try again in a minute.',
      503
    );
  }

  // The claimer's name doubles as the change-log actor: the signed link only
  // ever reaches (and can only claim for) this one person.
  const { data: person } = await db
    .from('staff')
    .select('display_name, email')
    .eq('id', verified.staffId)
    .maybeSingle();
  if (!person) {
    return page('Not found', "We couldn't match this link to anyone on the roster.", 404);
  }

  try {
    const result = await claimSubRequest(
      db,
      verified.subRequestId,
      verified.staffId,
      {
        kind: 'user',
        email: (person.email as string | null)?.toLowerCase() ?? null,
        label: person.display_name as string,
      },
      `${url.origin}/admin/schedule`
    );

    switch (result.outcome) {
      case 'claimed':
        return page(
          "It's yours",
          `You're on the <strong>${result.shift.label}</strong> shift, ${result.shift.shift_date}. The schedule board already shows the swap — thanks for stepping in!`,
          200
        );
      case 'already-claimed':
        return page(
          'Already covered',
          `${result.byName ?? 'Someone'} beat you to it — this shift is already covered. Nothing else to do.`,
          200
        );
      case 'cancelled':
        return page(
          'No longer needed',
          'This sub request was cancelled — the original person is keeping the shift.',
          200
        );
      case 'own-request':
        return page('That one is yours', "This is your own sub request — you can't claim it.", 400);
      case 'already-assigned':
        return page('Already on it', "You're already assigned to this shift.", 200);
      case 'past':
        return page('Too late', 'That shift date has already passed.', 410);
      case 'shift-gone':
        return page(
          'Shift gone',
          'That shift was cancelled or removed, so there is nothing to cover.',
          410
        );
      case 'not-found':
        return page('Not found', "We couldn't find this sub request.", 404);
      case 'error':
        console.error('[sub-claim] failed:', result.message);
        return page(
          'Something went wrong',
          'Something went wrong on our end — please try the link again in a minute.',
          500
        );
    }
  } catch (error) {
    console.error('[sub-claim] failed:', error);
    return page(
      'Something went wrong',
      'Something went wrong on our end — please try the link again in a minute.',
      500
    );
  }
};
