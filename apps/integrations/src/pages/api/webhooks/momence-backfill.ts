import {
  createWebhookLogger,
  setSubscriberTags,
  upsertSubscriber,
  type WebhookTracer,
} from '@pyre/webhook-core';
import { upsertResendContact } from '@/lib/email/audience';
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
  const authHeader = request.headers.get('Authorization');
  const expectedSecret = import.meta.env.MOMENCE_BACKFILL_SECRET;

  if (!expectedSecret) {
    log.error('MOMENCE_BACKFILL_SECRET not configured');
    return new Response(JSON.stringify({ error: 'Not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (authHeader !== `Bearer ${expectedSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const offset = Number.parseInt(url.searchParams.get('offset') ?? '0', 10);
  const limit = Number.parseInt(url.searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10);
  const targetParam = url.searchParams.get('target') ?? 'both';
  const dryRun = url.searchParams.get('dryRun') === 'true';

  if (targetParam !== 'mailchimp' && targetParam !== 'resend' && targetParam !== 'both') {
    return new Response(
      JSON.stringify({ error: 'Invalid target — use mailchimp, resend, or both' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
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

    return new Response(
      JSON.stringify({
        totalInMomence: totalCount,
        target,
        dryRun,
        processed: results.length,
        successes,
        failures,
        offset,
        limit,
        nextOffset: offset + members.length < totalCount ? offset + members.length : null,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    log.error('Backfill failed', error);
    return new Response(JSON.stringify({ error: 'Backfill failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST = instrumentWebhook('momence-backfill', handler);
