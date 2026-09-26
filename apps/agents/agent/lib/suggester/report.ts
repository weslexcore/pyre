// When a suggester turn ends, tell the integrations app, so a run whose agent
// never saved its suggestions — the model stopped without calling
// save_suggestions, the turn failed, or the save itself was refused — shows
// as failed at once instead of reading "Looking…" until it goes stale. The
// integrations side ignores this for a run that already saved (it only fails
// runs still queued or running), so it is sent after every turn.
//
// Best-effort: a report that can't be delivered is logged, and the run then
// goes stale on its own.

import { postAgentApi } from '../api';

export async function reportTurnEnded(
  runId: string | null,
  sessionId: string,
  error?: string
): Promise<void> {
  // Evals run without a run and never write.
  if (!runId || process.env.AGENT_FORCE_DRY_RUN === '1') return;
  try {
    const { status, body } = await postAgentApi('/api/agent/suggestions', {
      runId,
      agentSessionId: sessionId,
      ended: true,
      ...(error ? { error: error.slice(0, 900) } : {}),
    });
    if (status >= 400) {
      console.error(
        `[suggester] could not report the end of run ${runId} (HTTP ${status}): ${String(body.error ?? '')}`
      );
    }
  } catch (e) {
    console.error(`[suggester] could not report the end of run ${runId}:`, e);
  }
}
