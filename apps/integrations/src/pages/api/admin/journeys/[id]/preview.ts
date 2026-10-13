// Render one step's email as it would send — with sample merge values, or a
// real customer's live Momence data (`memberEmail`). Takes the step content
// from the request so unsaved edits preview immediately. Side-effect free.

import type { APIRoute } from 'astro';
import { renderStep } from '@/lib/email/journeys/admin';
import type { PreviewResponse } from '@/lib/email/journeys/api-types';
import { contentSchema } from '@/lib/email/journeys/schema';
import { gateMutation, json, readJsonBody } from '@/lib/http/route';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, params, request }) => {
  const gate = await gateMutation(cookies, request, '/admin/journeys');
  if (gate instanceof Response) return gate;
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const content = contentSchema.safeParse(body.content);
  if (!content.success) {
    return json({ error: content.error.issues.map((i) => i.message).join('; ') }, 400);
  }
  const memberEmail =
    typeof body.memberEmail === 'string' && body.memberEmail.trim()
      ? body.memberEmail.trim().toLowerCase()
      : undefined;
  const stepKey = typeof body.stepKey === 'string' ? body.stepKey : undefined;
  const memberId =
    typeof body.memberId === 'number' && Number.isInteger(body.memberId)
      ? body.memberId
      : undefined;

  try {
    const rendered = await renderStep(params.id ?? 'preview', content.data, {
      memberId,
      memberEmail,
      stepKey,
    });
    if ('error' in rendered) return json({ error: rendered.error }, 400);
    const response: PreviewResponse = {
      subject: rendered.subject,
      html: rendered.html,
      missing: rendered.missing,
      values: rendered.values as Record<string, string>,
    };
    return json(response);
  } catch (e) {
    return json({ error: `Render failed: ${e instanceof Error ? e.message : String(e)}` }, 400);
  }
};
