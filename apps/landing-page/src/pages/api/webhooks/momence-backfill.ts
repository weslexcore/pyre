import type { APIRoute } from 'astro';
import { createWebhookLogger } from '@/lib/webhooks/logger';
import { setSubscriberTags, upsertSubscriber } from '@/lib/webhooks/mailchimp';
import { fetchMomenceMembers, type MomenceMemberData } from '@/lib/webhooks/momence';

export const prerender = false;

const log = createWebhookLogger('Momence Backfill');

const DEFAULT_LIMIT = 25;

async function syncMember(
  member: MomenceMemberData
): Promise<{ success: boolean; error?: string }> {
  try {
    await upsertSubscriber({
      email: member.email,
      firstName: member.firstName,
      lastName: member.lastName,
      phone: member.phone,
      birthday: member.birthday,
    });

    const tags = [
      { name: 'Active Guest', status: 'active' as const },
      ...member.tags.map((name) => ({ name, status: 'active' as const })),
    ];
    await setSubscriberTags(member.email, tags);

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Failed to sync member ${member.email}: ${message}`);
    return { success: false, error: message };
  }
}

export const POST: APIRoute = async ({ request, url }) => {
  // Auth check
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

  log.info(`Starting backfill: offset=${offset} limit=${limit}`);

  try {
    const page = Math.floor(offset / limit);
    const { members, totalCount } = await fetchMomenceMembers(page, limit);

    log.info(`Processing ${members.length} members (total in Momence: ${totalCount})`);

    const results: { email: string; success: boolean; error?: string }[] = [];

    for (const member of members) {
      const result = await syncMember(member);
      results.push({ email: member.email, ...result });
    }

    const successes = results.filter((r) => r.success).length;
    const failures = results.filter((r) => !r.success);

    log.info(`Backfill complete: ${successes} synced, ${failures.length} failed`);

    return new Response(
      JSON.stringify({
        totalInMomence: totalCount,
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
