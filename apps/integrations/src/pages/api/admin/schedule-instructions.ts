// The standing instructions the AI schedule drafter carries into every run —
// the singleton schedule_agent_instructions row behind
// lib/schedule/agent-instructions.ts. Admin-only: this text shapes every
// draft the agent produces for everyone, so it sits above the
// schedule:manage capability, same as the employee-action toggles.

import { MAX_STANDING_INSTRUCTIONS_LENGTH } from '@pyre/schedule-core';
import type { APIRoute } from 'astro';
import { assertSameOrigin, requireAdmin } from '@/lib/auth/admin';
import { getDb } from '@/lib/db';
import {
  getScheduleAgentInstructions,
  setScheduleAgentInstructions,
} from '@/lib/schedule/agent-instructions';
import { actorFromGate, logScheduleChange } from '@/lib/schedule/change-log';

export const prerender = false;

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export const GET: APIRoute = async ({ cookies }) => {
  const gate = await requireAdmin(cookies);
  if (gate instanceof Response) return gate;

  return json({
    instructions: await getScheduleAgentInstructions(),
    maxLength: MAX_STANDING_INSTRUCTIONS_LENGTH,
  });
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

  if (typeof body.content !== 'string') {
    return json({ error: 'content must be a string' }, 400);
  }
  // The sanitiser truncates rather than rejects, so guard the obviously
  // oversized payload here instead of silently dropping half the text. The
  // slack mirrors the draft-note routes: a little over the cap is a stale
  // client, far over is a mistake worth naming.
  if (body.content.length > MAX_STANDING_INSTRUCTIONS_LENGTH * 2) {
    return json(
      {
        error: `Standing instructions must be ${MAX_STANDING_INSTRUCTIONS_LENGTH} characters or fewer`,
      },
      400
    );
  }

  const before = await getScheduleAgentInstructions();
  const { error, instructions } = await setScheduleAgentInstructions(
    body.content,
    (gate.user.email ?? '').toLowerCase() || null
  );
  if (error || !instructions) return json({ error: error ?? 'Save failed' }, 500);

  // Only a real edit is worth a log row — the settings panel saves whatever
  // is in the textarea, including an unchanged copy of it.
  const db = getDb();
  if (db && instructions.content !== before.content) {
    await logScheduleChange(db, {
      actor: actorFromGate(gate),
      entityType: 'agent_instructions',
      action: 'update',
      summary: instructions.content
        ? 'Updated the standing instructions for the schedule drafter'
        : 'Cleared the standing instructions for the schedule drafter',
      details: { before: before.content, after: instructions.content },
    });
  }

  return json({ instructions, maxLength: MAX_STANDING_INSTRUCTIONS_LENGTH });
};
