// Send one step's email to an address now, as a test: [TEST] in the subject,
// tagged kind=test, and outside sendTemplate's send log and dedupe (the same
// sanctioned exception as /api/admin/email-test-send). Merge fields come from
// samples or from `memberEmail`'s live data.

import type { APIRoute } from 'astro';
import { renderStep } from '@/lib/email/journeys/admin';
import { contentSchema } from '@/lib/email/journeys/schema';
import { getResend } from '@/lib/email/resend';
import { gateMutation, json, readJsonBody } from '@/lib/http/route';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ cookies, params, request }) => {
  const gate = await gateMutation(cookies, request, '/admin/journeys');
  if (gate instanceof Response) return gate;
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const content = contentSchema.safeParse(body.content);
  if (!content.success) {
    return json({ error: content.error.issues.map((i) => i.message).join('; ') }, 400);
  }
  const to = typeof body.to === 'string' ? body.to.trim() : '';
  if (!EMAIL_RE.test(to)) return json({ error: 'Enter a valid address to send to' }, 400);
  const memberEmail =
    typeof body.memberEmail === 'string' && body.memberEmail.trim()
      ? body.memberEmail.trim().toLowerCase()
      : undefined;
  const stepKey = typeof body.stepKey === 'string' ? body.stepKey : undefined;
  const memberId =
    typeof body.memberId === 'number' && Number.isInteger(body.memberId)
      ? body.memberId
      : undefined;

  const resend = getResend();
  if (!resend) return json({ error: 'Resend not configured (RESEND_API_KEY unset)' }, 503);

  const journeyId = params.id ?? 'preview';
  const rendered = await renderStep(journeyId, content.data, { memberId, memberEmail, stepKey });
  if ('error' in rendered) return json({ error: rendered.error }, 400);

  const subject = `[TEST] ${rendered.subject}`;
  const { data, error } = await resend.emails.send({
    from: import.meta.env.RESEND_FROM ?? 'Pyre <hello@pyresauna.com>',
    to,
    subject,
    html: rendered.html,
    tags: [
      { name: 'template', value: 'journey' },
      { name: 'kind', value: 'test' },
      { name: 'campaign', value: 'admin-test' },
      { name: 'journey', value: journeyId },
    ],
  });
  if (error) return json({ error: `Resend error: ${error.message ?? String(error)}` }, 502);
  return json({ id: data?.id ?? null, to, subject, missing: rendered.missing });
};
