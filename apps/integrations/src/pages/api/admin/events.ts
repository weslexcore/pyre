// Admin-gated proxy for the landing site's public events feed. UTM Assist runs
// on this app but builds links to landing-site events; proxying server-side
// avoids adding CORS headers to the public endpoint.

import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/auth/admin';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

const LANDING_ORIGIN = import.meta.env.PUBLIC_SITE_URL ?? 'https://pyresauna.com';

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  try {
    const res = await fetch(`${LANDING_ORIGIN}/api/events?all=1`);
    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: `Upstream events fetch failed (${res.status})` }),
        {
          status: 502,
          headers: JSON_HEADERS,
        }
      );
    }
    const body = await res.text();
    return new Response(body, { status: 200, headers: JSON_HEADERS });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), { status: 502, headers: JSON_HEADERS });
  }
};
