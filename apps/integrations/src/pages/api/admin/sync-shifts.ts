// Standalone "Sync Momence" trigger for the schedule board: runs the same
// syncShifts() the hourly cron uses and returns the diff summary. Admin
// cookie auth + CSRF (unlike /api/cron/tick, this is browser-called).

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireScheduleManage } from '@/lib/auth/admin';
import { actorFromGate } from '@/lib/schedule/change-log';
import { syncShifts } from '@/lib/schedule/sync';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

/** How far back a manual sync may reach to repair past days. */
const MAX_LOOKBACK_DAYS = 7;

/** Optional `{ lookbackDays }` body; absent or malformed means today only. */
async function readLookbackDays(request: Request): Promise<number | string> {
  if (!request.headers.get('content-type')?.includes('application/json')) return 0;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return 'Body must be JSON';
  }
  const raw = (body as { lookbackDays?: unknown } | null)?.lookbackDays;
  if (raw === undefined) return 0;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > MAX_LOOKBACK_DAYS) {
    return `lookbackDays must be an integer from 0 to ${MAX_LOOKBACK_DAYS}`;
  }
  return raw;
}

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requireScheduleManage(cookies);
  if (gate instanceof Response) return gate;

  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const lookbackDays = await readLookbackDays(request);
  if (typeof lookbackDays === 'string') {
    return new Response(JSON.stringify({ error: lookbackDays }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  try {
    const summary = await syncShifts({ actor: actorFromGate(gate), lookbackDays });
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
