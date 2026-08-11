// Standalone "Sync Momence" trigger for the schedule board: runs the same
// syncShifts() the hourly cron uses and returns the diff summary. Admin
// cookie auth + CSRF (unlike /api/cron/tick, this is browser-called).

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireScheduleManage } from '@/lib/auth/admin';
import { actorFromGate } from '@/lib/schedule/change-log';
import { syncShifts } from '@/lib/schedule/sync';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requireScheduleManage(cookies);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  try {
    const summary = await syncShifts({ actor: actorFromGate(gate) });
    return new Response(JSON.stringify({ ok: true, sync: summary }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Sync failed' }),
      { status: 500, headers: JSON_HEADERS }
    );
  }
};
