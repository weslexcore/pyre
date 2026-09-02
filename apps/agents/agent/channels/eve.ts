// Inbound auth for the HTTP session API (POST /eve/v1/session): the
// integrations app calls with `Authorization: Bearer ${EVE_CHANNEL_SECRET}`
// — its "Draft schedule" endpoint for the scheduler, its "Ask" endpoint for
// the knowledge assistant. Vercel OIDC covers CLI / internal-deployment
// access; localDev keeps `eve dev` open locally.
//
// Which role a session runs as is decided here too: a request carrying
// `x-pyre-agent: knowledge` (plus the asking staff member's access as JSON in
// `x-pyre-knowledge-scope`) has both stamped onto the session's auth
// attributes, and the instructions and tools resolve from them per session
// (lib/role.ts). Anything else is the scheduler. Only an authenticated
// caller reaches this point, so the headers are trusted as far as the
// caller is — and the scope only ever narrows what the knowledge tools read.
//
// The event handlers below keep the knowledge assistant's audit log
// (lib/knowledge/audit.ts): asker and scope at turn start, tool calls as
// they are requested, the answer, and the outcome. They see the session's
// auth, which hooks do not; the question itself is recorded by
// agent/hooks/knowledge_audit.ts.

import { type AuthFn, extractBearerToken, localDev, vercelOidc } from 'eve/channels/auth';
import { defaultEveAuth, eveChannel } from 'eve/channels/eve';
import {
  auditAnswer,
  auditOutcome,
  auditToolCalls,
  auditTurnStarted,
} from '../lib/knowledge/audit';
import {
  AGENT_HEADER,
  type KnowledgeScope,
  parseKnowledgeScope,
  resolveRole,
  SCOPE_HEADER,
} from '../lib/role';

function channelSecretAuth(): AuthFn<Request> {
  return (request) => {
    const secret = process.env.EVE_CHANNEL_SECRET;
    if (!secret) return null;

    const token = extractBearerToken(request.headers.get('authorization'));
    if (!token || token !== secret) return null;

    return {
      authenticator: 'channel-secret',
      principalId: 'pyre-integrations',
      principalType: 'service',
      attributes: {},
    };
  };
}

/** The knowledge scope of a session, or null for scheduler sessions. */
function knowledgeScopeOf(ctx: { session: { auth: Parameters<typeof resolveRole>[0] } }): KnowledgeScope | null {
  const { role, scope } = resolveRole(ctx.session.auth);
  return role === 'knowledge' ? scope : null;
}

export default eveChannel({
  auth: [channelSecretAuth(), vercelOidc(), localDev()],
  onMessage(ctx) {
    const caller = defaultEveAuth(ctx);
    if (!caller) return { auth: caller };

    const agent = ctx.eve.request.headers.get(AGENT_HEADER)?.trim().toLowerCase();
    if (agent !== 'knowledge') return { auth: caller };

    // Normalise through the parser so the stored attribute is always a
    // well-formed scope, whatever the header carried.
    const scope = parseKnowledgeScope(ctx.eve.request.headers.get(SCOPE_HEADER));
    return {
      auth: {
        ...caller,
        attributes: { ...caller.attributes, agent: 'knowledge', scope: JSON.stringify(scope) },
      },
    };
  },
  events: {
    async 'turn.started'(data, _channel, ctx) {
      const scope = knowledgeScopeOf(ctx);
      if (scope) await auditTurnStarted(ctx.session.id, data.turnId, scope);
    },
    async 'actions.requested'(data, _channel, ctx) {
      if (!knowledgeScopeOf(ctx)) return;
      const calls = data.actions
        .filter((a) => a.kind === 'tool-call')
        .map((a) => ({
          tool: (a as { toolName: string }).toolName,
          input: a.input as Record<string, unknown>,
        }));
      await auditToolCalls(ctx.session.id, data.turnId, calls);
    },
    async 'message.completed'(data, _channel, ctx) {
      if (!knowledgeScopeOf(ctx)) return;
      // Narration before a tool call ends with 'tool-calls'; the answer is
      // the block that ends the step for any other reason.
      if (data.finishReason !== 'tool-calls' && data.message) {
        await auditAnswer(ctx.session.id, data.turnId, data.message);
      }
    },
    async 'turn.completed'(data, _channel, ctx) {
      if (!knowledgeScopeOf(ctx)) return;
      await auditOutcome(ctx.session.id, data.turnId, 'answered');
    },
    async 'turn.failed'(data, _channel, ctx) {
      if (!knowledgeScopeOf(ctx)) return;
      await auditOutcome(ctx.session.id, data.turnId, 'failed', `${data.code}: ${data.message}`);
    },
    async 'turn.cancelled'(data, _channel, ctx) {
      if (!knowledgeScopeOf(ctx)) return;
      await auditOutcome(ctx.session.id, data.turnId, 'cancelled');
    },
  },
});
