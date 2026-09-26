// Which agent a session is. One Eve deployment hosts three roles — the
// staff-scheduling drafter (the original, and the default), the knowledge
// assistant, and the suggester — and the role is decided when the session is
// created: the integrations app sends `x-pyre-agent: knowledge` plus the
// asking staff member's knowledge scope, or `x-pyre-agent: suggester` plus
// the suggestion run and the record it is about, and the channel
// (agent/channels/eve.ts) stamps them onto the session's auth attributes.
// Instructions, model and tools then resolve per session from those
// attributes (agent/instructions/role.ts, agent/agent.ts,
// agent/tools/role_tools.ts). Anything without the header — cron schedules,
// the schedule board's draft button, evals by default — is the scheduler.

import type { SessionAuth, SessionAuthContext } from 'eve/context';

export type AgentRole = 'scheduler' | 'knowledge' | 'suggester';

export const AGENT_HEADER = 'x-pyre-agent';
export const SCOPE_HEADER = 'x-pyre-knowledge-scope';
/** Suggester sessions: the suggestion run to save into, and the record it is about. */
export const SUGGEST_RUN_HEADER = 'x-pyre-suggest-run';
export const SUGGEST_SOURCE_HEADER = 'x-pyre-suggest-source';

/** The record types a suggester session can be about (the integrations app's sources). */
export const SUGGEST_SOURCE_TYPES = ['shift_note'] as const;
export type SuggestSourceType = (typeof SUGGEST_SOURCE_TYPES)[number];

/**
 * What a suggester session works on: the record it reads, and the run its
 * suggestions are saved into (null in evals, which only ever dry-run).
 */
export interface SuggestTarget {
  runId: string | null;
  source: { type: SuggestSourceType; id: string } | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A run id from a header, or null. */
export function parseSuggestRun(raw: unknown): string | null {
  return typeof raw === 'string' && UUID_RE.test(raw.trim()) ? raw.trim().toLowerCase() : null;
}

/** `shift_note:<uuid>` from a header, or null when it is not one. */
export function parseSuggestSource(raw: unknown): SuggestTarget['source'] {
  if (typeof raw !== 'string') return null;
  const [type, id, ...rest] = raw.trim().split(':');
  if (rest.length > 0 || !id || !UUID_RE.test(id)) return null;
  if (!(SUGGEST_SOURCE_TYPES as readonly string[]).includes(type)) return null;
  return { type: type as SuggestSourceType, id: id.toLowerCase() };
}

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
  /**
   * Whether they hold the /admin/schedule page (the staff schedule: shifts,
   * who is working them, hours). The board shows every shift and its crew to
   * anyone with the grant, so this is all-or-nothing; the tools find the
   * asker's own shifts through the staff row matching `email`.
   */
  schedule: boolean;
}

/** The scope a knowledge session gets when the caller sends none: staff-level SOPs only. */
export const DEFAULT_KNOWLEDGE_SCOPE: KnowledgeScope = {
  role: 'staff',
  email: '',
  shiftNotes: null,
  incidents: null,
  water: false,
  schedule: false,
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
    schedule: v.schedule === true,
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
  suggest: SuggestTarget | null;
} {
  const principal = auth?.initiator ?? auth?.current ?? null;
  switch (attribute(principal, 'agent')) {
    case 'knowledge':
      return {
        role: 'knowledge',
        scope: parseKnowledgeScope(attribute(principal, 'scope')),
        suggest: null,
      };
    case 'suggester':
      return {
        role: 'suggester',
        scope: { ...DEFAULT_KNOWLEDGE_SCOPE },
        suggest: {
          runId: parseSuggestRun(attribute(principal, 'run')),
          source: parseSuggestSource(attribute(principal, 'source')),
        },
      };
    default:
      return { role: 'scheduler', scope: { ...DEFAULT_KNOWLEDGE_SCOPE }, suggest: null };
  }
}

/**
 * The record a suggester tool works on, from the session's auth — never from
 * the model's input, so nothing a note says can point the agent at another
 * record. Throws outside a suggester session.
 */
export function suggestTargetOf(ctx: {
  session?: { auth?: SessionAuth };
}): SuggestTarget & { source: NonNullable<SuggestTarget['source']> } {
  const { role, suggest } = resolveRole(ctx.session?.auth);
  if (role !== 'suggester' || !suggest) {
    throw new Error('Suggestion tools are only available in suggester sessions.');
  }
  if (!suggest.source) {
    throw new Error('This session was opened without a record to suggest for.');
  }
  return { runId: suggest.runId, source: suggest.source };
}
