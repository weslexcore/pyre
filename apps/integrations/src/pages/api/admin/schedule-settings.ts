// Admin toggles for the employee-facing schedule actions (shift requests,
// "unable to work") — the schedule_settings table behind
// lib/schedule/settings.ts. Admin-only: these change what every employee can
// do, so they sit above the schedule:manage capability.

import type { APIRoute } from 'astro';
import { assertSameOrigin, requireAdmin } from '@/lib/auth/admin';
import {
  getScheduleSettings,
  SCHEDULE_SETTING_KEYS,
  type ScheduleSettingKey,
  setScheduleSetting,
} from '@/lib/schedule/settings';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  return json({ settings: await getScheduleSettings() });
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const key = body.key;
  if (typeof key !== 'string' || !(SCHEDULE_SETTING_KEYS as readonly string[]).includes(key)) {
    return json({ error: `key must be one of: ${SCHEDULE_SETTING_KEYS.join(', ')}` }, 400);
  }
  if (typeof body.enabled !== 'boolean') {
    return json({ error: 'enabled must be a boolean' }, 400);
  }

  const { error } = await setScheduleSetting(
    key as ScheduleSettingKey,
    body.enabled,
    (gate.user.email ?? '').toLowerCase() || null
  );
  if (error) return json({ error }, 500);

  return json({ settings: await getScheduleSettings() });
};
