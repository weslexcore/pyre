import type { APIRoute } from 'astro';
import { escapeHtml, htmlPage } from '@/lib/http/page';
import { verifyMemberToken } from '@/lib/partner/member-token';
import { confirmMemberVerification, memberPerkLinks } from '@/lib/partner/member-verification';

export const prerender = false;

// The link a Pyre member gets after asking, on /perks, for us to vouch for them
// at a partner. GET only shows a button; the POST it submits does the Momence
// check and emails the partner. Acting on GET would let a mail scanner that
// prefetches links send the member's details to a third party unasked.

const BUTTON_STYLE =
  'button{background:#b3261e;color:#fff;border:0;border-radius:6px;padding:12px 24px;font-size:1rem;font-weight:600;cursor:pointer}';

function page(title: string, body: string, status: number): Response {
  return htmlPage({ title, body, status, style: BUTTON_STYLE });
}

function invalid(status: 'expired' | 'invalid'): Response {
  return status === 'expired'
    ? page(
        'Link expired',
        `<p>This link has expired. Ask again on <a href="${memberPerkLinks.perks()}">our perks page</a> and we'll send a fresh one.</p>`,
        410
      )
    : page(
        'Invalid link',
        '<p>This link is invalid. Please use the button from your email, or contact <a href="mailto:hello@pyresauna.com">hello@pyresauna.com</a>.</p>',
        400
      );
}

export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('token') ?? '';
  const verified = verifyMemberToken(token);
  if (verified.status !== 'valid') return invalid(verified.status);

  return page(
    'Confirm',
    `<p>Click below and we'll check your Pyre membership. If it's active, we'll email the partner your name, email, and membership so they can give you your perk.</p>
<form method="post"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit">Check and send my membership</button></form>`,
    200
  );
};

export const POST: APIRoute = async ({ request }) => {
  let token = '';
  try {
    const form = await request.formData();
    token = String(form.get('token') ?? '');
  } catch {
    // fall through to the invalid page
  }
  const verified = verifyMemberToken(token);
  if (verified.status !== 'valid') return invalid(verified.status);

  try {
    const result = await confirmMemberVerification(verified.requestId);
    switch (result.outcome) {
      case 'verified':
      case 'already-verified':
        return page(
          'Sent',
          `<p>You're all set. We've let ${escapeHtml(result.partnerName)} know your Pyre membership is active. Mention it next time you're in.</p>`,
          200
        );
      case 'not-member':
        return page(
          'No active membership',
          `<p>We couldn't find an active Pyre membership on this email, so we didn't contact ${escapeHtml(result.partnerName)}.</p>
<p>Book with a different email? Ask again on <a href="${memberPerkLinks.perks()}">our perks page</a> using that one. Not a member yet? <a href="${memberPerkLinks.memberships()}">See memberships</a>.</p>`,
          200
        );
      case 'closed':
        return invalid('expired');
      case 'not-found':
        return page('Not found', '<p>We couldn’t find this request.</p>', 404);
      case 'partner-unavailable':
        return page(
          'No longer available',
          '<p>This partner perk isn’t available right now. Questions? Email <a href="mailto:hello@pyresauna.com">hello@pyresauna.com</a>.</p>',
          410
        );
    }
  } catch (error) {
    console.error('[Partner] Member confirm failed', error);
    return page(
      'Something went wrong',
      '<p>Something went wrong on our end. Please try the link again in a minute. If it keeps failing, email <a href="mailto:hello@pyresauna.com">hello@pyresauna.com</a>.</p>',
      500
    );
  }
};
