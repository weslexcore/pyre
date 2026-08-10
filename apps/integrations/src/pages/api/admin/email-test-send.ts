// Sends a one-off test render of a registered email template to an address the
// admin enters on /admin/email-templates. Deliberately bypasses sendTemplate():
// test sends ignore the dev-mode delivery gate (EMAIL_LIVE_TEMPLATES /
// EMAIL_DEV_WHITELIST), skip suppression, idempotency, and the email_sends
// log — the Resend dashboard is the record, filterable by the kind=test /
// campaign=admin-test tags. Subjects are prefixed [TEST] so a real inbox can't
// mistake one for a production email.

import { render } from '@react-email/components';
import type { APIRoute } from 'astro';
import { type ComponentType, createElement } from 'react';
import { EMAIL_TEMPLATES } from '@/emails/registry';
import type { EmailTemplateKey } from '@/emails/types';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import { getResend } from '@/lib/email/resend';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isTemplateKey(value: unknown): value is EmailTemplateKey {
  return typeof value === 'string' && value in EMAIL_TEMPLATES;
}

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, '/admin/email-templates');
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { template, props, to } = (body ?? {}) as {
    template?: unknown;
    props?: unknown;
    to?: unknown;
  };

  if (!isTemplateKey(template)) {
    return json({ error: `Unknown template: ${String(template)}` }, 400);
  }
  if (typeof props !== 'object' || props === null || Array.isArray(props)) {
    return json({ error: 'props must be a JSON object' }, 400);
  }
  const recipient = typeof to === 'string' ? to.trim() : '';
  if (!EMAIL_RE.test(recipient)) {
    return json({ error: 'to must be a valid email address' }, 400);
  }

  const resend = getResend();
  if (!resend) {
    return json({ error: 'Resend not configured (RESEND_API_KEY unset)' }, 503);
  }

  // The admin editor sends free-form JSON, so the per-template prop typing is
  // erased here (same as email-preview.ts); a bad prop surfaces as a 400 with
  // the render error rather than a Resend failure.
  const entry = EMAIL_TEMPLATES[template] as unknown as {
    subject: (props: Record<string, unknown>) => string;
    Component: ComponentType<Record<string, unknown>>;
  };
  const renderProps = props as Record<string, unknown>;

  let html: string;
  let subject: string;
  try {
    html = await render(createElement(entry.Component, renderProps));
    subject = `[TEST] ${entry.subject(renderProps)}`;
  } catch (error) {
    return json(
      { error: `Render failed: ${error instanceof Error ? error.message : String(error)}` },
      400
    );
  }

  const from = import.meta.env.RESEND_FROM ?? 'Pyre <hello@pyresauna.com>';
  const { data, error } = await resend.emails.send({
    from,
    to: recipient,
    subject,
    html,
    tags: [
      { name: 'template', value: template },
      { name: 'kind', value: 'test' },
      { name: 'campaign', value: 'admin-test' },
    ],
  });
  if (error) {
    return json({ error: `Resend error: ${error.message ?? String(error)}` }, 502);
  }

  return json({ id: data?.id ?? null, to: recipient, subject });
};
