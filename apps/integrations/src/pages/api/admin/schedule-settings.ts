// Admin schedule settings — the employee-facing action toggles (shift
// requests, "unable to work") and when staff arrive before the first session
// and leave after the last — the schedule_settings table behind
// lib/schedule/settings.ts. Admin-only: these change what every employee can
// do, so they sit above the schedule:manage capability.

import { MAX_SHIFT_BUFFER_MIN } from '@pyre/schedule-core';
import type { APIRoute } from 'astro';
import { assertSameOrigin, requireAdmin } from '@/lib/auth/admin';
import {
  getScheduleSettings,
  parseSettingMinutes,
  SCHEDULE_MINUTE_SETTING_KEYS,
  SCHEDULE_SETTING_KEYS,
  type ScheduleMinuteSettingKey,
  type ScheduleSettingKey,
  setScheduleMinuteSetting,
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
  const updatedBy = (gate.user.email ?? '').toLowerCase() || null;

  if (
    typeof key === 'string' &&
    (SCHEDULE_MINUTE_SETTING_KEYS as readonly string[]).includes(key)
  ) {
    const minutes = parseSettingMinutes(body.minutes);
    if (minutes === null) {
      return json(
        { error: `minutes must be a whole number from 0 to ${MAX_SHIFT_BUFFER_MIN}` },
        400
      );
    }
    const { error } = await setScheduleMinuteSetting(
      key as ScheduleMinuteSettingKey,
      minutes,
      updatedBy
    );
    if (error) return json({ error }, 500);
    return json({ settings: await getScheduleSettings() });
  }

  if (typeof key !== 'string' || !(SCHEDULE_SETTING_KEYS as readonly string[]).includes(key)) {
    const keys = [...SCHEDULE_SETTING_KEYS, ...SCHEDULE_MINUTE_SETTING_KEYS];
    return json({ error: `key must be one of: ${keys.join(', ')}` }, 400);
  }
  if (typeof body.enabled !== 'boolean') {
    return json({ error: 'enabled must be a boolean' }, 400);
  }

  const { error } = await setScheduleSetting(key as ScheduleSettingKey, body.enabled, updatedBy);
  if (error) return json({ error }, 500);

  return json({ settings: await getScheduleSettings() });
};
