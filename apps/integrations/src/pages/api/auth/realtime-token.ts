// The access token the browser's Realtime client authenticates with, and
// the topic it may listen on. The session itself stays in httpOnly cookies
// the browser cannot read; this hands out only the short-lived access token
// (about an hour), scoped by RLS to what the signed-in person may see, and
// the bell asks again before it expires. Any dashboard user has an inbox.

import type { APIRoute } from 'astro';
import { requireStaff } from '@/lib/auth/admin';
import { json } from '@/lib/http/json';
import { notificationTopic } from '@/lib/notifications/realtime';

export const prerender = false;

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requireStaff(cookies);
  if (gate instanceof Response) return gate;
  if (!gate.accessToken) return json({ error: 'No session token' }, 503);

  return json({
    accessToken: gate.accessToken,
    expiresAt: gate.expiresAt,
    topic: notificationTopic(gate.user.email),
  });
};
