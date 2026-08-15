// The caller's own calendar subscription URL, for the Subscribe panel on
// /admin/schedule/calendar. GET mints the token on first ask (nobody who never
// subscribes carries a live credential); POST {action:'rotate'} replaces it,
// which is how a leaked or stale subscription link is revoked.
//
// Both methods act only on the row matching the caller's login email — there
// is no staffId parameter, so this can't be pointed at anyone else.

import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { APIRoute } from 'astro';
import { hasScheduleManage } from '@/components/admin/adminTools';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import { getDb, type StaffRow } from '@/lib/db';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function mintToken(): string {
  return randomBytes(24).toString('base64url');
}

interface FeedUrls {
  feedUrl: string;
  webcalUrl: string;
  teamFeedUrl: string | null;
  teamWebcalUrl: string | null;
  canManage: boolean;
}

function urlsFor(request: Request, person: StaffRow, token: string): FeedUrls {
  const origin = new URL(request.url).origin;
  const feedUrl = `${origin}/api/schedule/feed.ics?t=${token}`;
  const teamUrl = `${feedUrl}&scope=team`;
  const canManage = hasScheduleManage({ isAdmin: person.is_admin, pages: person.pages });

  // Apple Calendar and desktop Outlook subscribe straight from webcal://;
  // Google needs the https URL pasted into "From URL".
  const webcal = (https: string) => https.replace(/^https?:/, 'webcal:');

  return {
    feedUrl,
    webcalUrl: webcal(feedUrl),
    teamFeedUrl: canManage ? teamUrl : null,
    teamWebcalUrl: canManage ? webcal(teamUrl) : null,
    canManage,
  };
}

/** The staff row for the signed-in caller, matched on login email. */
async function selfRow(
  cookies: Parameters<APIRoute>[0]['cookies']
): Promise<{ person: StaffRow; db: SupabaseClient } | Response> {
  const gate = await requirePage(cookies, '/admin/schedule');
  if (gate instanceof Response) return gate;

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  const email = (gate.user.email ?? '').toLowerCase();
  if (!email) return json({ error: "Your login isn't linked to the schedule roster" }, 403);

  const { data, error } = await db.from('staff').select('*').eq('email', email).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: "Your login isn't linked to the schedule roster" }, 403);

  return { person: data as StaffRow, db };
}

export const GET: APIRoute = async ({ cookies, request }) => {
  const found = await selfRow(cookies);
  if (found instanceof Response) return found;
  const { person, db } = found;

  let token = person.calendar_token;
  if (!token) {
    // Conditional on still being null so two tabs opening the panel at once
    // can't hand out a token that isn't the one stored; the loser re-reads.
    const minted = mintToken();
    const { data, error } = await db
      .from('staff')
      .update({ calendar_token: minted })
      .eq('id', person.id)
      .is('calendar_token', null)
      .select('calendar_token')
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);

    if (data) {
      token = minted;
    } else {
      const { data: raced } = await db
        .from('staff')
        .select('calendar_token')
        .eq('id', person.id)
        .maybeSingle();
      token = (raced?.calendar_token as string | null) ?? null;
      if (!token) return json({ error: 'Could not create a calendar link' }, 500);
    }
  }

  return json(urlsFor(request, person, token));
};

export const POST: APIRoute = async ({ cookies, request }) => {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415);
  }
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  const found = await selfRow(cookies);
  if (found instanceof Response) return found;
  const { person, db } = found;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if ((body as { action?: string })?.action !== 'rotate') {
    return json({ error: "action must be 'rotate'" }, 400);
  }

  const token = mintToken();
  const { error } = await db.from('staff').update({ calendar_token: token }).eq('id', person.id);
  if (error) return json({ error: error.message }, 500);

  return json(urlsFor(request, person, token));
};
