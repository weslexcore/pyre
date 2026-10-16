// The staff "Ask" box: what the knowledge assistant in pyre-agents may read
// on behalf of the person asking, and the message shape a question travels
// in. The agent runs with a service-role key and applies the scope itself,
// so this is where the dashboard's access rules are translated for it —
// the SOP grants (lib/sops/role + levels), the per-page grants for the logs
// (adminTools), and the "everyone reads their own" split on shift notes and
// incident reports. Server-only (role resolution reads the staff table).

import { canViewPage, hasIncidentsManage, SHIFT_NOTES_HREF } from '@/components/admin/adminTools';
import type { AdminGate } from '@/lib/auth/admin';
import { canViewBoardsTool } from '@/lib/boards/access';
import type { SopRole } from '@/lib/sops/levels';
import { getSopRole } from '@/lib/sops/role';

/** Mirror of KnowledgeScope in apps/agents/agent/lib/role.ts. */
export interface KnowledgeScope {
  role: SopRole;
  email: string;
  shiftNotes: 'all' | 'mine' | null;
  incidents: 'all' | 'mine' | null;
  water: boolean;
  /** The staff schedule: shifts, crews, and hours — the board shows all of it to anyone with the page. */
  schedule: boolean;
  /**
   * Goals and boards: whether they hold the Boards tool or any single board.
   * Which boards, and whether they may create one, is resolved per call by
   * /api/agent/pyre from their email — this only says whether to offer the tools.
   */
  boards: boolean;
}

/** Request headers that turn a pyre-agents session into a knowledge session. */
export const KNOWLEDGE_AGENT_HEADER = 'x-pyre-agent';
export const KNOWLEDGE_SCOPE_HEADER = 'x-pyre-knowledge-scope';
/** A routine run's id, on sessions a routine opens, so the agent reports back when it ends. */
export const ROUTINE_RUN_HEADER = 'x-pyre-routine-run';

export function knowledgeScopeFor(gate: AdminGate): Promise<KnowledgeScope> {
  return knowledgeScopeForAccess(gate.user.email, gate.access);
}

/**
 * The same scope for a person by email and access, with no request behind it
 * — a scheduled routine runs as its owner from the cron tick.
 */
export async function knowledgeScopeForAccess(
  rawEmail: string,
  access: AdminGate['access']
): Promise<KnowledgeScope> {
  const email = normalizeEmail(rawEmail);
  const role = await getSopRole(email, access);
  return {
    role,
    email,
    // Shift notes: only with the page; then admins read every note, everyone
    // else the shared notes plus their own admin-only ones ('mine').
    shiftNotes: canViewPage(access, SHIFT_NOTES_HREF) ? (access.isAdmin ? 'all' : 'mine') : null,
    // Incidents: incidents:manage (or admin) reads the whole log, a plain page
    // grant is reporter-level — only the reports they filed.
    incidents: hasIncidentsManage(access)
      ? 'all'
      : canViewPage(access, '/admin/incidents')
        ? 'mine'
        : null,
    water: canViewPage(access, '/admin/water'),
    // Schedule: a plain page grant already shows every shift and who is on
    // it (names only — emails and pay stay on the manage/admin side, and the
    // agent never reads them), so the tool needs no all/mine split.
    schedule: canViewPage(access, '/admin/schedule'),
    boards: canViewBoardsTool(access),
  };
}

export function knowledgeHeaders(
  scope: KnowledgeScope,
  routineRunId?: string
): Record<string, string> {
  return {
    [KNOWLEDGE_AGENT_HEADER]: 'knowledge',
    [KNOWLEDGE_SCOPE_HEADER]: JSON.stringify(scope),
    ...(routineRunId ? { [ROUTINE_RUN_HEADER]: routineRunId } : {}),
  };
}

/**
 * The message that carries a routine's request into a fresh session. The
 * request rides in the same <staff-question> block a typed question does, so
 * the audit log and the history show it as the question; the lead tells the
 * agent nobody is waiting on the other end and when it last ran.
 */
export function buildRoutineMessage(
  routine: { title: string; prompt: string },
  lastRunAt: string | null
): string {
  const since = lastRunAt
    ? `It last ran ${lastRunAt} (UTC); where the request says "since last time", that is the window.`
    : 'This is its first run.';
  return (
    `This is a scheduled request the staff member saved as "${sanitizeQuestion(routine.title)}". ` +
    'Nobody is watching it run: do not ask questions back — make reasonable assumptions, say ' +
    'what they were, and deliver the complete answer in one reply. ' +
    `${since} Answer it per your instructions, with links to what you used.\n` +
    `<staff-question>\n${sanitizeRoutinePrompt(routine.prompt)}\n</staff-question>`
  );
}

/** sanitizeQuestion's rules at the routine length. */
export function sanitizeRoutinePrompt(raw: string): string {
  return raw
    .replace(/<\/?staff-question>?/gi, '')
    .replace(CONTROL_CHARS, '')
    .trim()
    .slice(0, ROUTINE_PROMPT_MAX)
    .trim();
}

const ROUTINE_PROMPT_MAX = 2000;

import { normalizeEmail } from '@/lib/email/address';
import { MAX_QUESTION_LENGTH } from './question';

export { MAX_QUESTION_LENGTH };

/** Control characters that have no business in a question — newlines and tabs stay. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/**
 * Trim, drop control characters, and neutralise anything that would close the
 * delimiter the question is wrapped in, so a stray `</staff-question>` can't
 * end the block early and read as instructions to the agent.
 */
export function sanitizeQuestion(raw: string): string {
  return raw
    .replace(/<\/?staff-question>?/gi, '')
    .replace(CONTROL_CHARS, '')
    .trim()
    .slice(0, MAX_QUESTION_LENGTH)
    .trim();
}

/** The message that carries one staff question into a knowledge session. */
export function buildAskMessage(question: string, followUp = false): string {
  const lead = followUp
    ? 'The same staff member has a follow-up question. Answer it from the knowledge base per ' +
      'your instructions — search again rather than relying on what you found before if the ' +
      'topic has moved.'
    : 'A staff member asked the question below. Answer it from the knowledge base per your ' +
      'instructions, with links to the documents you used.';
  return `${lead}\n<staff-question>\n${question}\n</staff-question>`;
}
