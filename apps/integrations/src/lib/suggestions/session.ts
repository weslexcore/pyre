// Start the pyre-agents suggester on one run. The run and its source travel
// as session headers, which the agents' channel stamps onto the session's
// auth — the agent's save_suggestions tool reads them from there, never from
// the model, so nothing in a note's text can point the agent at another
// record. Server-only.

import { agentsEveConfig } from '@/lib/agent/eve-config';
import type { AgentSuggestionRunRow } from '@/lib/db';
import { startEveSession } from '@/lib/schedule/eve-session';

export const SUGGESTER_HEADERS = {
  agent: 'x-pyre-agent',
  run: 'x-pyre-suggest-run',
  source: 'x-pyre-suggest-source',
} as const;

/** Whether the agents app is configured at all; suggestions are off without it. */
export function suggesterConfigured(): boolean {
  return agentsEveConfig() !== null;
}

/** Opens the session and returns its id. Throws when the agents app refuses. */
export async function startSuggesterSession(
  run: Pick<AgentSuggestionRunRow, 'id' | 'source_type' | 'source_id'>
): Promise<string | null> {
  const config = agentsEveConfig({
    [SUGGESTER_HEADERS.agent]: 'suggester',
    [SUGGESTER_HEADERS.run]: run.id,
    [SUGGESTER_HEADERS.source]: `${run.source_type}:${run.source_id}`,
  });
  if (!config) throw new Error('Agents app not configured (AGENTS_BASE_URL / EVE_CHANNEL_SECRET)');
  return startEveSession(
    config,
    'Suggest follow-up actions for the record in your context. Start with get_suggestion_context, and finish with exactly one save_suggestions call, even if it is empty.'
  );
}
