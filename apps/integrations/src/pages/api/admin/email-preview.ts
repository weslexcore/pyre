// Renders a registered email template to HTML for the admin template browser
// (/admin/email-templates). Admin-gated and side-effect free: it renders the
// exact registry components sendTemplate() sends, but never touches Resend or
// the send log.

import { render } from '@react-email/components';
import type { APIRoute } from 'astro';
import { type ComponentType, createElement } from 'react';
import { EMAIL_TEMPLATES } from '@/emails/registry';
import type { EmailTemplateKey } from '@/emails/types';
import { gateMutation, json, readJsonBody } from '@/lib/http/route';

function isTemplateKey(value: unknown): value is EmailTemplateKey {
  return typeof value === 'string' && value in EMAIL_TEMPLATES;
}

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await gateMutation(cookies, request, '/admin/email-templates');
  if (gate instanceof Response) return gate;

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const { template, props } = body as { template?: unknown; props?: unknown };

  if (!isTemplateKey(template)) {
    return json({ error: `Unknown template: ${String(template)}` }, 400);
  }
  if (typeof props !== 'object' || props === null || Array.isArray(props)) {
    return json({ error: 'props must be a JSON object' }, 400);
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
    return json({ html, subject });
  } catch (error) {
    return json(
      {
        error: `Render failed: ${error instanceof Error ? error.message : String(error)}`,
      },
      400
    );
  }
};
