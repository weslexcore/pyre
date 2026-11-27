// One newsletter: GET it (with the list counts and campaign options), PATCH
// a draft's campaign, list or content, DELETE a draft.

import type { APIRoute } from 'astro';
import { getEmailGate } from '@/lib/email/dev-mode';
import { listCampaignOptions } from '@/lib/email/journeys/campaign';
import {
  audienceCounts,
  deleteDraft,
  getIssue,
  parseDraft,
  saveDraft,
} from '@/lib/email/newsletter/admin';
import type { NewsletterDetailResponse } from '@/lib/email/newsletter/api-types';
import { NEWSLETTER_TEMPLATE } from '@/lib/email/newsletter/batch';
import { beginDelete, beginMutation, beginRead, isUuid, json, storeError } from '@/lib/http/route';

export const prerender = false;

const PAGE = '/admin/newsletters';

export const GET: APIRoute = async ({ cookies, params }) => {
  const ready = await beginRead(cookies, PAGE);
  if (ready instanceof Response) return ready;
  if (!isUuid(params.id)) return json({ error: 'Not found' }, 404);
  try {
    const [issue, audience, gate, campaigns] = await Promise.all([
      getIssue(ready.db, params.id),
      audienceCounts(ready.db),
      getEmailGate(),
      listCampaignOptions(),
    ]);
    if (!issue) return json({ error: 'Not found' }, 404);
    const body: NewsletterDetailResponse = {
      issue,
      audience,
      templateLive: gate.isLive(NEWSLETTER_TEMPLATE),
      canSend: ready.gate.access.isAdmin,
      campaigns: campaigns.filter((c) => !c.archived).map((c) => c.slug),
    };
    return json(body);
  } catch (e) {
    return storeError('Newsletters', e);
  }
};

export const PATCH: APIRoute = async ({ cookies, params, request }) => {
  const ready = await beginMutation(cookies, request, PAGE);
  if (ready instanceof Response) return ready;
  if (!isUuid(params.id)) return json({ error: 'Not found' }, 404);
  const parsed = parseDraft(ready.body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const result = await saveDraft(ready.db, params.id, parsed.draft);
  if (!result.ok) return json({ error: result.error }, result.status);
  return json({ issue: result.issue });
};

export const DELETE: APIRoute = async ({ cookies, params, request }) => {
  const ready = await beginDelete(cookies, request, PAGE);
  if (ready instanceof Response) return ready;
  if (!isUuid(params.id)) return json({ error: 'Not found' }, 404);
  const failed = await deleteDraft(ready.db, params.id);
  if (failed && !failed.ok) return json({ error: failed.error }, failed.status);
  return json({ ok: true });
};
