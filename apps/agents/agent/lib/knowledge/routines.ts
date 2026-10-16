// When a turn ends in a session a saved routine opened (Pyre Agent routines),
// tell the integrations app, which closes the run and notifies its owner
// that the answer is ready. Sent after every turn of such a session — a
// person may follow up in it later — and ignored there for a run already
// closed.
//
// Best-effort: a report that can't be delivered is logged, and the
// integrations tick settles the run from the audit log once it is stale.

import { postAgentApi } from '../api';

export async function reportRoutineEnded(
  runId: string,
  sessionId: string,
  error?: string
): Promise<void> {
  if (process.env.AGENT_FORCE_DRY_RUN === '1') return;
  try {
    const { status, body } = await postAgentApi('/api/agent/routines', {
      runId,
      sessionId,
      ...(error ? { error: error.slice(0, 900) } : {}),
    });
    if (status >= 400) {
      console.error(
        `[routines] could not report the end of run ${runId} (HTTP ${status}): ${String(body.error ?? '')}`
      );
    }
  } catch (e) {
    console.error(`[routines] could not report the end of run ${runId}:`, e);
  }
}
