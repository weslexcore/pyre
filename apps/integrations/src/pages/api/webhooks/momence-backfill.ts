import {
  createWebhookLogger,
  setSubscriberTags,
  upsertSubscriber,
  type WebhookTracer,
} from '@pyre/webhook-core';
import { upsertResendContact } from '@/lib/email/audience';
import { hasBearer } from '@/lib/http/bearer';
import { json } from '@/lib/http/route';
import { instrumentWebhook, type TracedAPIRoute } from '@/lib/webhooks/instrument';
import { fetchMomenceMembers, type MomenceMemberData } from '@/lib/webhooks/momence';

export const prerender = false;

const log = createWebhookLogger('Momence Backfill');

const DEFAULT_LIMIT = 25;

type BackfillTarget = 'mailchimp' | 'resend' | 'both';

async function syncMember(
  member: MomenceMemberData,
  target: BackfillTarget,
  dryRun: boolean,
  tracer: WebhookTracer
): Promise<{ success: boolean; error?: string }> {
  try {
    if (dryRun) {
      log.info(`[dry run] Would sync ${member.email} to ${target}`, {
        tags: member.tags,
      });
      return { success: true };
    }

    if (target === 'mailchimp' || target === 'both') {
      await tracer.span(
        `Upsert subscriber: ${member.email}`,
        () =>
          upsertSubscriber({
            email: member.email,
            firstName: member.firstName,
            lastName: member.lastName,
            phone: member.phone,
            birthday: member.birthday,
          }),
        { email: member.email }
      );

      const tags = [
        { name: 'Active Guest', status: 'active' as const },
        ...member.tags.map((name) => ({ name, status: 'active' as const })),
      ];
      await tracer.span(`Set tags: ${member.email}`, () => setSubscriberTags(member.email, tags), {
        email: member.email,
        tags: tags.map((t) => t.name),
      });
    }

    if (target === 'resend' || target === 'both') {
      await tracer.span(
        `Upsert Resend contact: ${member.email}`,
        () =>
          upsertResendContact({
            email: member.email,
            firstName: member.firstName,
            lastName: member.lastName,
          }),
        { email: member.email }
      );
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Failed to sync member ${member.email}: ${message}`);
    return { success: false, error: message };
  }
}

const handler: TracedAPIRoute = async ({ request, url }, tracer) => {
  const expectedSecret = import.meta.env.MOMENCE_BACKFILL_SECRET;

  if (!expectedSecret) {
    log.error('MOMENCE_BACKFILL_SECRET not configured');
    return json({ error: 'Not configured' }, 500);
  }

  if (!hasBearer(request, expectedSecret, 'momence-backfill')) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const offset = Number.parseInt(url.searchParams.get('offset') ?? '0', 10);
  const limit = Number.parseInt(url.searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10);
  const targetParam = url.searchParams.get('target') ?? 'both';
  const dryRun = url.searchParams.get('dryRun') === 'true';

  if (targetParam !== 'mailchimp' && targetParam !== 'resend' && targetParam !== 'both') {
    return json({ error: 'Invalid target — use mailchimp, resend, or both' }, 400);
  }
  const target: BackfillTarget = targetParam;

  log.info(`Starting backfill: offset=${offset} limit=${limit} target=${target} dryRun=${dryRun}`);

  try {
    const page = Math.floor(offset / limit);
    const { members, totalCount } = await tracer.span(
      'Fetch Momence members',
      () => fetchMomenceMembers(page, limit),
      { page, limit }
    );

    log.info(`Processing ${members.length} members (total in Momence: ${totalCount})`);

    const results: { email: string; success: boolean; error?: string }[] = [];

    for (const member of members) {
      const result = await syncMember(member, target, dryRun, tracer);
      results.push({ email: member.email, ...result });
    }

    const successes = results.filter((r) => r.success).length;
    const failures = results.filter((r) => !r.success);

    log.info(`Backfill complete: ${successes} synced, ${failures.length} failed`);

    return json({
      totalInMomence: totalCount,
      target,
      dryRun,
      processed: results.length,
      successes,
      failures,
      offset,
      limit,
      nextOffset: offset + members.length < totalCount ? offset + members.length : null,
    });
  } catch (error) {
    log.error('Backfill failed', error);
    return json({ error: 'Backfill failed' }, 500);
  }
};

export const POST = instrumentWebhook('momence-backfill', handler);
