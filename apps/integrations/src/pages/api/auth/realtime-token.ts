// What the browser's Realtime client needs: the project URL and publishable
// key (public by design, but kept out of the client bundle so the env needs
// no PUBLIC_ twins), the signed-in person's access token, and the topic they
// may listen on. The session itself stays in httpOnly cookies the browser
// cannot read; this hands out only the short-lived access token (about an
// hour), scoped by RLS to what the person may see, and the bell asks again
// before it expires. Any dashboard user has an inbox.

import type { APIRoute } from 'astro';
import { requireStaff } from '@/lib/auth/admin';
import { json } from '@/lib/http/json';
import { notificationTopic } from '@/lib/notifications/realtime';
import { supabasePublicConfig } from '@/lib/supabase/server';

export const prerender = false;

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requireStaff(cookies);
  if (gate instanceof Response) return gate;
  const config = supabasePublicConfig();
  if (!gate.accessToken || !config) return json({ error: 'No session token' }, 503);

  return json({
    url: config.url,
    key: config.key,
    accessToken: gate.accessToken,
    expiresAt: gate.expiresAt,
    topic: notificationTopic(gate.user.email),
  });
};
