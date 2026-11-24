// Send the editor's newsletter to one address now, as a test: [TEST] in the
// subject, tagged kind=test, and outside the send log (the same sanctioned
// exception as /api/admin/email-test-send). The copy carries the recipient's
// real unsubscribe link and one-click headers, so those can be checked too;
// using them unsubscribes that address.

import type { APIRoute } from 'astro';
import { blockContentSchema } from '@/lib/email/journeys/schema';
import { CAMPAIGN_RE } from '@/lib/email/newsletter/admin';
import { NEWSLETTER_TEMPLATE } from '@/lib/email/newsletter/batch';
import {
  NewsletterContentError,
  personalize,
  renderNewsletter,
} from '@/lib/email/newsletter/render';
import { getResend } from '@/lib/email/resend';
import { buildUnsubscribeUrl } from '@/lib/email/unsubscribe-token';
import { gateMutation, json, readJsonBody } from '@/lib/http/route';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await gateMutation(cookies, request, '/admin/newsletters');
  if (gate instanceof Response) return gate;
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const content = blockContentSchema.safeParse(body.content);
  if (!content.success) {
    return json({ error: content.error.issues.map((i) => i.message).join('; ') }, 400);
  }
  const to = typeof body.to === 'string' ? body.to.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(to)) return json({ error: 'Enter a valid address to send to' }, 400);
  const campaign =
    typeof body.campaign === 'string' && CAMPAIGN_RE.test(body.campaign.trim())
      ? body.campaign.trim()
      : 'newsletter';
  const firstName = typeof body.firstName === 'string' ? body.firstName : undefined;

  const resend = getResend();
  if (!resend) return json({ error: 'Resend not configured (RESEND_API_KEY unset)' }, 503);
  const unsubscribeUrl = buildUnsubscribeUrl(to);
  if (!unsubscribeUrl) return json({ error: 'Unsubscribe links cannot be signed here' }, 503);

  let copy: ReturnType<typeof personalize>;
  try {
    copy = personalize(await renderNewsletter(content.data, campaign), {
      firstName,
      unsubscribeUrl,
    });
  } catch (e) {
    const message =
      e instanceof NewsletterContentError
        ? e.problems.join(' ')
        : e instanceof Error
          ? e.message
          : String(e);
    return json({ error: message }, 400);
  }

  const subject = `[TEST] ${copy.subject}`;
  const { data, error } = await resend.emails.send({
    from:
      import.meta.env.NEWSLETTER_FROM ||
      import.meta.env.RESEND_FROM ||
      'Pyre <hello@pyresauna.com>',
    to,
    subject,
    html: copy.html,
    text: copy.text,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    tags: [
      { name: 'template', value: NEWSLETTER_TEMPLATE },
      { name: 'kind', value: 'test' },
      { name: 'campaign', value: 'admin-test' },
    ],
  });
  if (error) return json({ error: `Resend error: ${error.message ?? String(error)}` }, 502);
  return json({ id: data?.id ?? null, to, subject });
};
