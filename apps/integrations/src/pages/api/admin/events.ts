// Admin-gated proxy for the landing site's public events feed. The Campaigns
// tool runs on this app but builds links to landing-site events; proxying
// server-side avoids adding CORS headers to the public endpoint.

import type { APIRoute } from 'astro';
import { requirePage } from '@/lib/auth/admin';
import { JSON_HEADERS, json } from '@/lib/http/route';
import { siteOrigin } from '@/lib/origins';

const LANDING_ORIGIN = siteOrigin();

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requirePage(cookies, '/admin/campaigns');
  if (gate instanceof Response) return gate;

  try {
    const res = await fetch(`${LANDING_ORIGIN}/api/events?all=1`);
    if (!res.ok) {
      return json({ error: `Upstream events fetch failed (${res.status})` }, 502);
    }
    const body = await res.text();
    return new Response(body, { status: 200, headers: JSON_HEADERS });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return json({ error: message }, 502);
  }
};
