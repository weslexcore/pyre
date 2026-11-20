// Pyre Agent's window onto the goals, boards and inventory: the pyre-agents
// knowledge role calls this for every goal, board, card and inventory read,
// and for every change it proposes, on behalf of the person in the
// conversation. Their access is resolved here, fresh, from their email (the
// same lookup the dashboard's own gate makes), so a read never shows a board
// or a list they could not open and a proposal they could never apply is
// refused while the agent can still fix it. Nothing here changes a board or
// the inventory: proposals are stored pending (lib/pyre-agent/actions) and
// the person applies them from the chat.
//
//   POST { email, sessionId, turnId?, op, input }
//     op 'goals'     → every goal they can see, where it stands, and their boards
//     op 'board'     → { slug } one board: goal, KPIs, columns, cards
//     op 'cards'     → { query?, board?, assignee?, state?, dueBy?, overdue?, limit? }
//     op 'inventory' → { query?, filter?, category?, limit? } the inventory list
//     op 'propose'   → { kind, ...the change, rationale } → { proposal } | 422 { error }
//     op 'messages'  → { query?, limit?, includeArchived? } the admin messages they can open
//     op 'message'   → { id } one message in full
//     op 'suggest'   → { kind: sop.edit | sop.create | message.create | message.edit,
//                        payload, rationale }
//                      → { suggestion, reviewer } | 4xx { error }
//     op 'suggest_inventory' → { changes: [{ kind: inventory.count | inventory.create,
//                                ...payload, shiftNoteId?, rationale }] }
//                      → { suggestions, reviewer } | 4xx { error, index? }
//                      (one batch, read out of shift notes, approved together)
//     op 'schedule_draft'  → { weekStart } the week's open draft, item by item, and
//                            whether a draft or revision is still being worked on
//     op 'schedule_start'  → { weekStart, note? } start a fresh draft (the board's
//                            Draft button, as the person) → { started, weekStart }
//     op 'schedule_revise' → { weekStart, note } ask for changes to the open draft
//                            → { started, weekStart }
//   The schedule ops need the schedule's manage grant. Confirming parts of a
//   draft is a proposal (op 'propose', kind schedule.review), applied only
//   when the person presses Apply — the agent never makes a draft live.
//
// A suggestion is not a proposal: it goes through the shift-note suggestion
// pipeline (lib/pyre-agent/suggestions) and is decided by whoever decides
// suggestions — the asker in the chat when they can, the admins otherwise.
//
// Auth: Bearer AGENT_API_SECRET (server-to-server; never cookies). The email
// comes from the session's scope on the agent side — stamped there by
// /api/admin/knowledge-ask from the asker's own login — not from the model.

import type { APIRoute } from 'astro';
import { canViewPage, hasScheduleManage } from '@/components/admin/adminTools';
import { agentUnauthorizedResponse, isAgentAuthorized } from '@/lib/agent/auth';
import { getAccess } from '@/lib/auth/access';
import { canViewBoardsTool } from '@/lib/boards/access';
import { getDb } from '@/lib/db';
import { normalizeEmail } from '@/lib/email/address';
import { json } from '@/lib/http/route';
import { INVENTORY_HREF } from '@/lib/inventory/types';
import { proposeAction } from '@/lib/pyre-agent/actions';
import { inventoryForAgent } from '@/lib/pyre-agent/inventory';
import { messageForAgent, messagesForAgent } from '@/lib/pyre-agent/messages';
import { loadScheduleDraft } from '@/lib/pyre-agent/schedule';
import {
  isPyreAgentSuggestionKind,
  PYRE_AGENT_SUGGESTION_KINDS,
  parseInventoryChanges,
  suggestFromConversation,
  suggestInventoryFromConversation,
} from '@/lib/pyre-agent/suggestions';
import {
  ACTION_KINDS,
  type ActionKind,
  INVENTORY_ACTION_KINDS,
  PYRE_AGENT_HREF,
  SCHEDULE_ACTION_KINDS,
} from '@/lib/pyre-agent/types';
import { boardForAgent, findCardsForAgent, goalsForAgent } from '@/lib/pyre-agent/workspace';
import {
  type DraftRequester,
  isWeekStart,
  parseDraftNote,
  refineDraft,
  startDraftRuns,
} from '@/lib/schedule/draft-run';
import type { SopViewer } from '@/lib/sops/levels';
import { getPeopleNames } from '@/lib/sops/people';
import { getSopRole } from '@/lib/sops/role';
import { isUuid } from '@/lib/suggestions/types';

const NO_BOARDS = 'This person has no boards; there are no goals or tasks to show them';
const NO_INVENTORY = 'This person does not hold the Inventory page; the list is not theirs to see';
const NO_SCHEDULE =
  'This person cannot manage the schedule, so they cannot draft or confirm one; a schedule manager or an admin can';
const SCHEDULE_OPS = ['schedule_draft', 'schedule_start', 'schedule_revise'];

/** The person as the schedule change log and the draft request name them. */
async function requesterFor(email: string, sessionId: string): Promise<DraftRequester> {
  const names = await getPeopleNames([email]);
  return {
    actor: { kind: 'user', email, label: names[email] || email },
    origin: 'pyre_agent',
    pyreSessionId: sessionId || null,
  };
}

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

  // The asker must still hold the agent page, and the page each op reads
  // (some board, or the inventory) — access can be taken away
  // mid-conversation.
  const access = await getAccess(email);
  if (!access || !canViewPage(access, PYRE_AGENT_HREF)) {
    return json({ error: 'This person no longer has access to Pyre Agent' }, 403);
  }
  const boards = canViewBoardsTool(access);
  const inventory = canViewPage(access, INVENTORY_HREF);
  const boardOps = ['goals', 'board', 'cards'];
  if (boardOps.includes(String(body.op)) && !boards) return json({ error: NO_BOARDS }, 403);
  if ((body.op === 'inventory' || body.op === 'suggest_inventory') && !inventory) {
    return json({ error: NO_INVENTORY }, 403);
  }
  const scheduleManage = hasScheduleManage(access);
  if (SCHEDULE_OPS.includes(String(body.op)) && !scheduleManage) {
    return json({ error: NO_SCHEDULE }, 403);
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
      case 'inventory': {
        const filter = input.filter;
        return json(
          await inventoryForAgent(db, access, {
            query: typeof input.query === 'string' ? input.query : undefined,
            filter:
              filter === 'low' || filter === 'reorder'
                ? 'reorder'
                : filter === 'due' || filter === 'inactive' || filter === 'all'
                  ? filter
                  : undefined,
            category: typeof input.category === 'string' ? input.category : undefined,
            limit: typeof input.limit === 'number' ? input.limit : undefined,
          })
        );
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
        const onInventory = (INVENTORY_ACTION_KINDS as readonly string[]).includes(kind);
        const onSchedule = (SCHEDULE_ACTION_KINDS as readonly string[]).includes(kind);
        if (onInventory && !inventory) return json({ error: NO_INVENTORY }, 403);
        if (onSchedule && !scheduleManage) return json({ error: NO_SCHEDULE }, 403);
        if (!onInventory && !onSchedule && !boards) return json({ error: NO_BOARDS }, 403);
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
      case 'messages': {
        const viewer: SopViewer = { role: await getSopRole(email, access), email };
        return json(
          await messagesForAgent(db, viewer, {
            query: typeof input.query === 'string' ? input.query : undefined,
            limit: typeof input.limit === 'number' ? input.limit : undefined,
            includeArchived: input.includeArchived === true,
          })
        );
      }
      case 'message': {
        if (!isUuid(input.id))
          return json({ error: 'id must be a message id from get_messages' }, 400);
        const viewer: SopViewer = { role: await getSopRole(email, access), email };
        const result = await messageForAgent(db, viewer, input.id);
        return json(result, 'error' in result ? 404 : 200);
      }
      case 'suggest': {
        if (!sessionId) return json({ error: 'sessionId is required to suggest' }, 400);
        if (!isPyreAgentSuggestionKind(input.kind)) {
          return json(
            { error: `kind must be one of ${PYRE_AGENT_SUGGESTION_KINDS.join(', ')}` },
            400
          );
        }
        const viewer: SopViewer = { role: await getSopRole(email, access), email };
        const result = await suggestFromConversation(
          db,
          access,
          { email, viewer, sessionId },
          input.kind,
          {
            payload: isRecord(input.payload) ? input.payload : {},
            rationale: typeof input.rationale === 'string' ? input.rationale : '',
          }
        );
        if (!result.ok) return json({ error: result.error }, result.status);
        return json({ suggestion: result.suggestion, reviewer: result.reviewer });
      }
      case 'suggest_inventory': {
        if (!sessionId) return json({ error: 'sessionId is required to suggest' }, 400);
        const parsed = parseInventoryChanges(input.changes);
        if (!parsed.ok) {
          return json(
            { error: parsed.error, ...(parsed.index !== undefined ? { index: parsed.index } : {}) },
            400
          );
        }
        const result = await suggestInventoryFromConversation(
          db,
          access,
          { email, sessionId },
          parsed.changes
        );
        if (!result.ok) {
          return json(
            { error: result.error, ...(result.index !== undefined ? { index: result.index } : {}) },
            result.status
          );
        }
        return json({ suggestions: result.suggestions, reviewer: result.reviewer });
      }
      case 'schedule_draft': {
        if (!isWeekStart(input.weekStart)) {
          return json({ error: 'weekStart must be a Monday as YYYY-MM-DD' }, 400);
        }
        return json(await loadScheduleDraft(db, input.weekStart));
      }
      case 'schedule_start': {
        if (!isWeekStart(input.weekStart)) {
          return json({ error: 'weekStart must be a Monday as YYYY-MM-DD' }, 400);
        }
        const note = parseDraftNote(input.note, false);
        if (!note.ok) return json({ error: note.error }, 400);
        const current = await loadScheduleDraft(db, input.weekStart);
        if (current.inProgress) {
          return json(
            { error: 'A draft for this week is already being worked on; wait for it to land' },
            409
          );
        }
        const result = await startDraftRuns(
          db,
          [input.weekStart],
          note.note,
          await requesterFor(email, sessionId)
        );
        if (!result.ok) return json({ error: result.error }, result.status);
        return json({
          started: true,
          weekStart: input.weekStart,
          replacesOpenDraft: !!current.draft,
          syncError: 'error' in result.sync ? result.sync.error : null,
        });
      }
      case 'schedule_revise': {
        if (!isWeekStart(input.weekStart)) {
          return json({ error: 'weekStart must be a Monday as YYYY-MM-DD' }, 400);
        }
        const note = parseDraftNote(input.note, true);
        if (!note.ok) return json({ error: note.error }, 400);
        const result = await refineDraft(
          db,
          input.weekStart,
          note.note,
          await requesterFor(email, sessionId)
        );
        if (!result.ok) return json({ error: result.error }, result.status);
        return json({ started: true, weekStart: input.weekStart });
      }
      default:
        return json(
          {
            error:
              'op must be goals, board, cards, inventory, propose, messages, message, suggest, suggest_inventory, schedule_draft, schedule_start, or schedule_revise',
          },
          400
        );
    }
  } catch (error) {
    console.error('[pyre-agent] op failed:', error);
    return json({ error: error instanceof Error ? error.message : 'The read failed' }, 500);
  }
};
