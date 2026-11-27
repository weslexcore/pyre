// Render a newsletter as one person would get it, from the editor's unsaved
// content, with what would stop it being sent. Side-effect free.

import type { APIRoute } from 'astro';
import { blockContentSchema } from '@/lib/email/journeys/schema';
import { CAMPAIGN_RE } from '@/lib/email/newsletter/admin';
import type { NewsletterPreviewResponse } from '@/lib/email/newsletter/api-types';
import { newsletterProblems } from '@/lib/email/newsletter/content';
import { personalize, renderNewsletter } from '@/lib/email/newsletter/render';
import { gateMutation, json, readJsonBody } from '@/lib/http/route';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await gateMutation(cookies, request, '/admin/newsletters');
  if (gate instanceof Response) return gate;
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;

  const content = blockContentSchema.safeParse(body.content);
  if (!content.success) {
    return json({ error: content.error.issues.map((i) => i.message).join('; ') }, 400);
  }
  const campaign =
    typeof body.campaign === 'string' && CAMPAIGN_RE.test(body.campaign.trim())
      ? body.campaign.trim()
      : 'newsletter';
  const firstName = typeof body.firstName === 'string' ? body.firstName : undefined;

  try {
    const template = await renderNewsletter(content.data, campaign, { allowProblems: true });
    // The preview's unsubscribe link goes nowhere; a test send carries a real one.
    const copy = personalize(template, { firstName, unsubscribeUrl: '#unsubscribe' });
    const response: NewsletterPreviewResponse = {
      subject: copy.subject,
      html: copy.html,
      problems: newsletterProblems(content.data),
    };
    return json(response);
  } catch (e) {
    return json({ error: `Render failed: ${e instanceof Error ? e.message : String(e)}` }, 400);
  }
};
