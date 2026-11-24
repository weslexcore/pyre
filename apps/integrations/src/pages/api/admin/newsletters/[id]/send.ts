// Approve a newsletter for sending (admins only). With `sendAfter` it waits
// for that time; without, it starts now: the first batches go out inside
// this request, and the hourly cron tick carries on with anything left.

import type { APIRoute } from 'astro';
import { getEmailGate } from '@/lib/email/dev-mode';
import { approveSend, getIssue } from '@/lib/email/newsletter/admin';
import { NEWSLETTER_TEMPLATE } from '@/lib/email/newsletter/batch';
import { runNewsletterSends } from '@/lib/email/newsletter/send-job';
import { beginMutation, isUuid, json } from '@/lib/http/route';

export const prerender = false;

/** Time this request spends sending before it leaves the rest to the cron tick. */
const INLINE_BUDGET_MS = 40_000;

export const POST: APIRoute = async ({ cookies, params, request }) => {
  const started = Date.now();
  const ready = await beginMutation(cookies, request, '/admin/newsletters');
  if (ready instanceof Response) return ready;
  if (!ready.gate.access.isAdmin) return json({ error: 'Only admins can send a newsletter' }, 403);
  if (!isUuid(params.id)) return json({ error: 'Not found' }, 404);

  let sendAfter: string | null = null;
  if (ready.body.sendAfter != null && ready.body.sendAfter !== '') {
    const at = new Date(String(ready.body.sendAfter));
    if (Number.isNaN(at.getTime())) return json({ error: 'That send time is not a date' }, 400);
    if (at.getTime() > Date.now() + 60_000) sendAfter = at.toISOString();
  }

  const gate = await getEmailGate();
  if (!gate.isLive(NEWSLETTER_TEMPLATE)) {
    return json(
      {
        error:
          'The newsletter template is not live, so nothing would go out. Turn it on in Email Templates first.',
      },
      409
    );
  }

  const approved = await approveSend(ready.db, params.id, sendAfter);
  if (!approved.ok) return json({ error: approved.error }, approved.status);
  if (sendAfter) return json({ issue: approved.issue });

  const deadline = started + INLINE_BUDGET_MS;
  const run = await runNewsletterSends(
    { dryRun: false, timeRemainingMs: () => deadline - Date.now() },
    { onlyId: params.id }
  ).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
  const issue = (await getIssue(ready.db, params.id)) ?? approved.issue;
  return json({ issue, run });
};
