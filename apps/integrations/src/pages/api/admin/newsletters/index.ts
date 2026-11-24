// Newsletters (/admin/newsletters): GET lists every issue with the mailing
// list counts; POST starts a new draft for this (or next) month.

import type { APIRoute } from 'astro';
import { getEmailGate } from '@/lib/email/dev-mode';
import { audienceCounts, createIssue, listIssues } from '@/lib/email/newsletter/admin';
import type { NewsletterListResponse } from '@/lib/email/newsletter/api-types';
import { NEWSLETTER_TEMPLATE } from '@/lib/email/newsletter/batch';
import { beginMutation, beginRead, json, storeError } from '@/lib/http/route';

export const prerender = false;

const PAGE = '/admin/newsletters';

export const GET: APIRoute = async ({ cookies }) => {
  const ready = await beginRead(cookies, PAGE);
  if (ready instanceof Response) return ready;
  try {
    const [issues, audience, gate] = await Promise.all([
      listIssues(ready.db),
      audienceCounts(ready.db),
      getEmailGate(),
    ]);
    const body: NewsletterListResponse = {
      issues,
      audience,
      templateLive: gate.isLive(NEWSLETTER_TEMPLATE),
    };
    return json(body);
  } catch (e) {
    return storeError('Newsletters', e);
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const ready = await beginMutation(cookies, request, PAGE);
  if (ready instanceof Response) return ready;
  const result = await createIssue(ready.db, ready.email);
  if (!result.ok) return json({ error: result.error }, result.status);
  return json({ issue: result.issue }, 201);
};
