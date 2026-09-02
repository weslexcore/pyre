// Which agent a session is. One Eve deployment hosts two roles — the
// staff-scheduling drafter (the original, and the default) and the knowledge
// assistant — and the role is decided when the session is created: the
// integrations app sends `x-pyre-agent: knowledge` plus the asking staff
// member's knowledge scope, and the channel (agent/channels/eve.ts) stamps
// both onto the session's auth attributes. Instructions and tools then
// resolve per session from those attributes (agent/instructions/role.ts,
// agent/tools/role_tools.ts). Anything without the header — cron schedules,
// the schedule board's draft button, evals by default — is the scheduler.

import type { SessionAuth, SessionAuthContext } from 'eve/context';

export type AgentRole = 'scheduler' | 'knowledge';

export const AGENT_HEADER = 'x-pyre-agent';
export const SCOPE_HEADER = 'x-pyre-knowledge-scope';

export const SOP_ROLES = ['staff', 'shift_lead', 'admin'] as const;
export type SopRole = (typeof SOP_ROLES)[number];

/** How much of a log source the asker may read. */
export type LogScope = 'all' | 'mine' | null;

/**
 * The asking staff member's dashboard access, as resolved by the
 * integrations app (which owns the staff table and the SOP grant rules).
 * Every knowledge tool filters by it.
 */
export interface KnowledgeScope {
  /** Their SOP role — admins read everything, others read what their grants allow. */
  role: SopRole;
  /** Their session email, lowercased; empty when the session has none. */
  email: string;
  /** Shift notes: admins read all, everyone else their own, null = no page grant. */
  shiftNotes: LogScope;
  /** Incident reports: incidents:manage reads all, reporters their own, null = no page grant. */
  incidents: LogScope;
  /** Whether they hold the /admin/water page (the cold tub water log). */
  water: boolean;
}

/** The scope a knowledge session gets when the caller sends none: staff-level SOPs only. */
export const DEFAULT_KNOWLEDGE_SCOPE: KnowledgeScope = {
  role: 'staff',
  email: '',
  shiftNotes: null,
  incidents: null,
  water: false,
};

function logScope(value: unknown): LogScope {
  return value === 'all' || value === 'mine' ? value : null;
}

/** Parse a scope from untrusted JSON, falling back field by field to the default. */
export function parseKnowledgeScope(raw: unknown): KnowledgeScope {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_KNOWLEDGE_SCOPE };
    }
  }
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_KNOWLEDGE_SCOPE };
  const v = value as Record<string, unknown>;
  const role = (SOP_ROLES as readonly string[]).includes(String(v.role))
    ? (v.role as SopRole)
    : 'staff';
  const email = typeof v.email === 'string' ? v.email.trim().toLowerCase().slice(0, 320) : '';
  return {
    role,
    email,
    shiftNotes: logScope(v.shiftNotes),
    incidents: logScope(v.incidents),
    water: v.water === true,
  };
}

function attribute(auth: SessionAuthContext | null, key: string): string | undefined {
  const value = auth?.attributes[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * The role and scope of a session. The initiator decides: a follow-up in the
 * same conversation must not flip an agent mid-session, so `current` is only
 * consulted when there is no initiator (which should not happen, but the
 * scheduler default keeps a stray session harmless — its tools cannot read
 * the knowledge base).
 */
export function resolveRole(auth: SessionAuth | undefined): {
  role: AgentRole;
  scope: KnowledgeScope;
} {
  const principal = auth?.initiator ?? auth?.current ?? null;
  if (attribute(principal, 'agent') !== 'knowledge') {
    return { role: 'scheduler', scope: { ...DEFAULT_KNOWLEDGE_SCOPE } };
  }
  return { role: 'knowledge', scope: parseKnowledgeScope(attribute(principal, 'scope')) };
}
