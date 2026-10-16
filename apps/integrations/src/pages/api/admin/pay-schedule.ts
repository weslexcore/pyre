// The pay schedule behind the schedule's paydays (lib/schedule/pay-schedule.ts),
// edited from the board's ⚙ Settings panel. Admin-only, like the other
// schedule settings: it changes what every employee sees.
//
// Both methods answer with the schedule plus a preview of the next few
// paydays, so the panel can show what a change actually does.

import {
  type PaySchedule,
  parsePaySchedule,
  todayEastern,
  upcomingPaydays,
} from '@pyre/schedule-core';
import type { APIRoute } from 'astro';
import { assertSameOrigin, requireAdmin } from '@/lib/auth/admin';
import { json } from '@/lib/http/route';
import { getPaySchedule, setPaySchedule } from '@/lib/schedule/pay-schedule';

export const prerender = false;

const PREVIEW_COUNT = 4;

function respond(schedule: PaySchedule | null): Response {
  return json({
    schedule,
    upcoming: schedule ? upcomingPaydays(schedule, todayEastern(), PREVIEW_COUNT) : [],
  });
}

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  return respond(await getPaySchedule());
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;
  const crossOrigin = assertSameOrigin(request);
  if (crossOrigin) return crossOrigin;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const schedule = parsePaySchedule(body);
  if ('error' in schedule) return json({ error: schedule.error }, 400);

  const updatedBy = (gate.user.email ?? '').toLowerCase() || null;
  const { error } = await setPaySchedule(schedule, updatedBy);
  if (error) return json({ error }, 500);

  return respond(await getPaySchedule());
};
