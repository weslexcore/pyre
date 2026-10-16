// Pyre Agent's window onto the goals and boards: the pyre-agents knowledge
// role calls this for every goal, board, and card read, and for every change
// it proposes, on behalf of the person in the conversation. Their access is
// resolved here, fresh, from their email (the same lookup the dashboard's
// own gate makes), so a read never shows a board they could not open and a
// proposal they could never apply is refused while the agent can still fix
// it. Nothing here changes a board: proposals are stored pending
// (lib/pyre-agent/actions) and the person applies them from the chat.
//
//   POST { email, sessionId, turnId?, op, input }
//     op 'goals'   → every goal they can see, where it stands, and their boards
//     op 'board'   → { slug } one board: goal, KPIs, columns, cards
//     op 'cards'   → { query?, board?, assignee?, state?, dueBy?, overdue?, limit? }
//     op 'propose' → { kind, ...the change, rationale } → { proposal } | 422 { error }
//
// Auth: Bearer AGENT_API_SECRET (server-to-server; never cookies). The email
// comes from the session's scope on the agent side — stamped there by
// /api/admin/knowledge-ask from the asker's own login — not from the model.

import type { APIRoute } from 'astro';
import { canViewPage } from '@/components/admin/adminTools';
import { agentUnauthorizedResponse, isAgentAuthorized } from '@/lib/agent/auth';
import { getAccess } from '@/lib/auth/access';
import { canViewBoardsTool } from '@/lib/boards/access';
import { getDb } from '@/lib/db';
import { normalizeEmail } from '@/lib/email/address';
import { json } from '@/lib/http/route';
import { proposeAction } from '@/lib/pyre-agent/actions';
import { ACTION_KINDS, type ActionKind, PYRE_AGENT_HREF } from '@/lib/pyre-agent/types';
import { boardForAgent, findCardsForAgent, goalsForAgent } from '@/lib/pyre-agent/workspace';

export const prerender = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export const POST: APIRoute = async ({ request }) => {
  if (!isAgentAuthorized(request)) return agentUnauthorizedResponse();

  const db = getDb();
  if (!db) return json({ error: 'Storage unavailable' }, 503);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const email = normalizeEmail(typeof body.email === 'string' ? body.email : '');
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  const input = isRecord(body.input) ? body.input : {};
  if (!email) return json({ error: 'email is required' }, 400);

  // The asker must still hold the agent page, and some board, for any of
  // this — access can be taken away mid-conversation.
  const access = await getAccess(email);
  if (!access || !canViewPage(access, PYRE_AGENT_HREF)) {
    return json({ error: 'This person no longer has access to Pyre Agent' }, 403);
  }
  if (!canViewBoardsTool(access)) {
    return json(
      { error: 'This person has no boards; there are no goals or tasks to show them' },
      403
    );
  }

  try {
    switch (body.op) {
      case 'goals':
        return json(await goalsForAgent(db, access));
      case 'board': {
        const slug = typeof input.slug === 'string' ? input.slug.trim() : '';
        const result = await boardForAgent(db, access, slug);
        return json(result, 'error' in result ? 404 : 200);
      }
      case 'cards': {
        const result = await findCardsForAgent(db, access, email, {
          query: typeof input.query === 'string' ? input.query : undefined,
          board: typeof input.board === 'string' ? input.board.trim() : undefined,
          assignee: typeof input.assignee === 'string' ? input.assignee : undefined,
          state:
            input.state === 'finished' || input.state === 'all' || input.state === 'open'
              ? input.state
              : undefined,
          dueBy:
            typeof input.dueBy === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.dueBy)
              ? input.dueBy
              : undefined,
          overdue: input.overdue === true,
          limit: typeof input.limit === 'number' ? input.limit : undefined,
        });
        return json(result, 'error' in result ? 404 : 200);
      }
      case 'propose': {
        if (!sessionId) return json({ error: 'sessionId is required to propose' }, 400);
        const kind = input.kind;
        if (typeof kind !== 'string' || !(ACTION_KINDS as readonly string[]).includes(kind)) {
          return json({ error: `kind must be one of ${ACTION_KINDS.join(', ')}` }, 400);
        }
        const result = await proposeAction(
          db,
          access,
          {
            email,
            sessionId,
            turnId: typeof body.turnId === 'string' ? body.turnId : null,
          },
          kind as ActionKind,
          input
        );
        if (!result.ok) return json({ error: result.error }, 422);
        return json({ proposal: result.action });
      }
      default:
        return json({ error: 'op must be goals, board, cards, or propose' }, 400);
    }
  } catch (error) {
    console.error('[pyre-agent] op failed:', error);
    return json({ error: error instanceof Error ? error.message : 'The read failed' }, 500);
  }
};
