// Renders a registered email template to HTML for the admin template browser
// (/admin/email-templates). Admin-gated and side-effect free: it renders the
// exact registry components sendTemplate() sends, but never touches Resend or
// the send log.

import { render } from '@react-email/components';
import type { APIRoute } from 'astro';
import { type ComponentType, createElement } from 'react';
import { EMAIL_TEMPLATES } from '@/emails/registry';
import type { EmailTemplateKey } from '@/emails/types';
import { requirePage } from '@/lib/auth/admin';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function isTemplateKey(value: unknown): value is EmailTemplateKey {
  return typeof value === 'string' && value in EMAIL_TEMPLATES;
}

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requirePage(cookies, '/admin/email-templates');
  if (gate instanceof Response) return gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  const { template, props } = (body ?? {}) as { template?: unknown; props?: unknown };

  if (!isTemplateKey(template)) {
    return new Response(JSON.stringify({ error: `Unknown template: ${String(template)}` }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }
  if (typeof props !== 'object' || props === null || Array.isArray(props)) {
    return new Response(JSON.stringify({ error: 'props must be a JSON object' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  // The admin editor sends free-form JSON, so the per-template prop typing is
  // erased here; the render try/catch below is the shape check (a bad prop
  // surfaces as a 400 with the render error message).
  const entry = EMAIL_TEMPLATES[template] as unknown as {
    subject: (props: Record<string, unknown>) => string;
    Component: ComponentType<Record<string, unknown>>;
  };
  const renderProps = props as Record<string, unknown>;

  try {
    const html = await render(createElement(entry.Component, renderProps));
    const subject = entry.subject(renderProps);
    return new Response(JSON.stringify({ html, subject }), { status: 200, headers: JSON_HEADERS });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: `Render failed: ${error instanceof Error ? error.message : String(error)}`,
      }),
      { status: 400, headers: JSON_HEADERS }
    );
  }
};
