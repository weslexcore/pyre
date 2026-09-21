// The admin's standing scheduling instructions (the singleton
// schedule_agent_instructions row), read here and folded into the scheduler's
// system prompt by agent/instructions/role.ts. Reading them on the agent side
// rather than stuffing them into each drafting message is what makes them
// global: cron drafts, board drafts, and refinement turns all start from the
// same prompt.
//
// Never fatal. A missing row, an unreachable database, or a schema that
// predates the migration all read as "no standing instructions" — a draft
// without them beats no draft at all.

import { sanitizeStandingInstructions } from '@pyre/schedule-core';
import { getDb } from '../db';

/** Same ~30s window the integrations app caches its schedule settings for. */
const CACHE_TTL_MS = 30_000;

let cache: { content: string; at: number } | null = null;

export function invalidateStandingInstructionsCache(): void {
  cache = null;
}

/**
 * The saved standing instructions, sanitised, or '' when there are none.
 * Re-sanitised on read so text saved before a rule changed still gets the
 * current treatment.
 */
export async function loadStandingInstructions(): Promise<string> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.content;

  try {
    const { data, error } = await getDb()
      .from('schedule_agent_instructions')
      .select('content')
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const content = sanitizeStandingInstructions(
      typeof data?.content === 'string' ? data.content : ''
    );
    cache = { content, at: Date.now() };
    return content;
  } catch (error) {
    console.warn('[standing-instructions] load failed:', error);
    // A stale snapshot beats dropping the admin's standing rules mid-flight.
    return cache?.content ?? '';
  }
}
