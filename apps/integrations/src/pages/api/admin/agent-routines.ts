// A person's Pyre Agent routines (/admin/ask/routines): requests saved to run
// on a cadence, each run a conversation in their own history. Everyone with
// the agent page grant (/admin/ask) keeps their own; nobody sees anyone
// else's, and each runs as its owner (lib/pyre-agent/routines).
//
//   GET                          → { routines }
//   POST   { title, prompt, frequency, weekdays?, monthDay?, hour, enabled? }
//                                → { routine } 201
//   POST   { action: 'run', id } → { runId, sessionId, token } — runs it now,
//                                  and the page opens the conversation
//   PATCH  { id, ...the same fields } → { routine }
//   DELETE ?id=<uuid>            → { ok: true }

import type { APIRoute } from 'astro';
import { assertSameOrigin, requirePage } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import { normalizeEmail } from '@/lib/email/address';
import { isUuid } from '@/lib/http/json';
import { dbError, json } from '@/lib/http/route';
import { nextRunAt, parseRoutineInput } from '@/lib/pyre-agent/cadence';
import {
  cadenceOf,
  type RoutineRow,
  type RoutineRunRow,
  routineView,
  startRoutineRun,
} from '@/lib/pyre-agent/routines';
import { PYRE_AGENT_HREF } from '@/lib/pyre-agent/types';

export const prerender = false;

/** Plenty for one person; a bound so a stuck form cannot fill the table. */
const MAX_ROUTINES = 25;

async function gateAndDb(cookies: Parameters<APIRoute>[0]['cookies'], request?: Request) {
  const gate = await requirePage(cookies, PYRE_AGENT_HREF);
  if (gate instanceof Response) return gate;
  if (request) {
    const crossOrigin = assertSameOrigin(request);
    if (crossOrigin) return crossOrigin;
  }
  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);
  const email = normalizeEmail(gate.user.email);
  if (!email) return json({ error: 'Session has no email' }, 400);
  return { db, email };
}

async function readBody(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
}

async function loadOwn(
  db: NonNullable<ReturnType<typeof getDb>>,
  email: string,
  id: unknown
): Promise<RoutineRow | null> {
  if (!isUuid(id)) return null;
  const { data } = await db
    .from('pyre_agent_routines')
    .select('*')
    .eq('id', id)
    .eq('owner_email', email)
    .maybeSingle();
  return (data as RoutineRow) ?? null;
}

export const GET: APIRoute = async ({ cookies }) => {
  const ready = await gateAndDb(cookies);
  if (ready instanceof Response) return ready;
  const { db, email } = ready;

  const { data, error } = await db
    .from('pyre_agent_routines')
    .select('*')
    .eq('owner_email', email)
    .order('created_at', { ascending: true })
    .limit(MAX_ROUTINES);
  if (error) return dbError(error);
  const routines = (data ?? []) as RoutineRow[];

  const lastRuns = new Map<string, RoutineRunRow>();
  if (routines.length > 0) {
    const { data: runs } = await db
      .from('pyre_agent_routine_runs')
      .select('*')
      .in(
        'routine_id',
        routines.map((r) => r.id)
      )
      .order('started_at', { ascending: false })
      .limit(routines.length * 5);
    for (const run of (runs ?? []) as RoutineRunRow[]) {
      if (!lastRuns.has(run.routine_id)) lastRuns.set(run.routine_id, run);
    }
  }

  return json({ routines: routines.map((r) => routineView(r, lastRuns.get(r.id) ?? null)) });
};

export const POST: APIRoute = async ({ cookies, request }) => {
  const ready = await gateAndDb(cookies, request);
  if (ready instanceof Response) return ready;
  const { db, email } = ready;
  const body = await readBody(request);
  if (body instanceof Response) return body;

  if (body.action === 'run') {
    const routine = await loadOwn(db, email, body.id);
    if (!routine) return json({ error: 'Routine not found' }, 404);
    const result = await startRoutineRun(db, routine, 'manual', new Date().toISOString());
    if (!result.ok) return json({ error: result.error }, 502);
    return json({ runId: result.runId, sessionId: result.sessionId, token: result.token });
  }

  const parsed = parseRoutineInput(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const { count } = await db
    .from('pyre_agent_routines')
    .select('id', { count: 'exact', head: true })
    .eq('owner_email', email);
  if ((count ?? 0) >= MAX_ROUTINES) {
    return json({ error: `You can keep ${MAX_ROUTINES} routines; delete one first` }, 409);
  }

  const { title, prompt, cadence, enabled } = parsed.value;
  const { data, error } = await db
    .from('pyre_agent_routines')
    .insert({
      owner_email: email,
      title,
      prompt,
      frequency: cadence.frequency,
      weekdays: cadence.weekdays,
      month_day: cadence.monthDay,
      hour: cadence.hour,
      enabled,
      next_run_at: enabled ? nextRunAt(cadence, new Date()) : null,
    })
    .select('*')
    .single();
  if (error) return dbError(error);
  return json({ routine: routineView(data as RoutineRow, null) }, 201);
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const ready = await gateAndDb(cookies, request);
  if (ready instanceof Response) return ready;
  const { db, email } = ready;
  const body = await readBody(request);
  if (body instanceof Response) return body;

  const before = await loadOwn(db, email, body.id);
  if (!before) return json({ error: 'Routine not found' }, 404);

  // A partial body (the pause switch) keeps whatever it does not name.
  const merged = {
    title: before.title,
    prompt: before.prompt,
    frequency: before.frequency,
    weekdays: before.weekdays,
    monthDay: before.month_day,
    hour: before.hour,
    enabled: before.enabled,
    ...body,
  };
  const parsed = parseRoutineInput(merged);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const { title, prompt, cadence, enabled } = parsed.value;

  // The next slot moves with the cadence; resuming starts from now, so a
  // routine paused for a month does not fire the moment it is switched on.
  const sameCadence =
    JSON.stringify(cadence) === JSON.stringify(cadenceOf(before)) && before.enabled && enabled;
  const next = !enabled
    ? null
    : sameCadence && before.next_run_at
      ? before.next_run_at
      : nextRunAt(cadence, new Date());

  const { data, error } = await db
    .from('pyre_agent_routines')
    .update({
      title,
      prompt,
      frequency: cadence.frequency,
      weekdays: cadence.weekdays,
      month_day: cadence.monthDay,
      hour: cadence.hour,
      enabled,
      next_run_at: next,
    })
    .eq('id', before.id)
    .select('*')
    .single();
  if (error) return dbError(error);

  const { data: lastRun } = await db
    .from('pyre_agent_routine_runs')
    .select('*')
    .eq('routine_id', before.id)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return json({ routine: routineView(data as RoutineRow, (lastRun as RoutineRunRow) ?? null) });
};

export const DELETE: APIRoute = async ({ cookies, request, url }) => {
  const ready = await gateAndDb(cookies, request);
  if (ready instanceof Response) return ready;
  const { db, email } = ready;

  const routine = await loadOwn(db, email, url.searchParams.get('id'));
  if (!routine) return json({ error: 'Routine not found' }, 404);
  // Its runs go with it (cascade); the conversations stay in the history.
  const { error } = await db.from('pyre_agent_routines').delete().eq('id', routine.id);
  if (error) return dbError(error);
  return json({ ok: true });
};
