// The staff "Ask" box: what the knowledge assistant in pyre-agents may read
// on behalf of the person asking, and the message shape a question travels
// in. The agent runs with a service-role key and applies the scope itself,
// so this is where the dashboard's access rules are translated for it —
// the SOP grants (lib/sops/role + levels), the per-page grants for the logs
// (adminTools), and the "everyone reads their own" split on shift notes and
// incident reports. Server-only (role resolution reads the staff table).

import { canViewPage, hasIncidentsManage, SHIFT_NOTES_HREF } from '@/components/admin/adminTools';
import type { AdminGate } from '@/lib/auth/admin';
import { normalizeEmail, type SopRole } from '@/lib/sops/levels';
import { getSopRole } from '@/lib/sops/role';

/** Mirror of KnowledgeScope in apps/agents/agent/lib/role.ts. */
export interface KnowledgeScope {
  role: SopRole;
  email: string;
  shiftNotes: 'all' | 'mine' | null;
  incidents: 'all' | 'mine' | null;
  water: boolean;
}

/** Request headers that turn a pyre-agents session into a knowledge session. */
export const KNOWLEDGE_AGENT_HEADER = 'x-pyre-agent';
export const KNOWLEDGE_SCOPE_HEADER = 'x-pyre-knowledge-scope';

export async function knowledgeScopeFor(gate: AdminGate): Promise<KnowledgeScope> {
  const email = normalizeEmail(gate.user.email);
  const role = await getSopRole(email, gate.access);
  return {
    role,
    email,
    // Shift notes: admins read every note, everyone else only their own.
    shiftNotes: gate.access.isAdmin
      ? 'all'
      : canViewPage(gate.access, SHIFT_NOTES_HREF)
        ? 'mine'
        : null,
    // Incidents: incidents:manage (or admin) reads the whole log, a plain page
    // grant is reporter-level — only the reports they filed.
    incidents: hasIncidentsManage(gate.access)
      ? 'all'
      : canViewPage(gate.access, '/admin/incidents')
        ? 'mine'
        : null,
    water: canViewPage(gate.access, '/admin/water'),
  };
}

export function knowledgeHeaders(scope: KnowledgeScope): Record<string, string> {
  return {
    [KNOWLEDGE_AGENT_HEADER]: 'knowledge',
    [KNOWLEDGE_SCOPE_HEADER]: JSON.stringify(scope),
  };
}

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
