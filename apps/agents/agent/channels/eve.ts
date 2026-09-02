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

import { type AuthFn, extractBearerToken, localDev, vercelOidc } from 'eve/channels/auth';
import { defaultEveAuth, eveChannel } from 'eve/channels/eve';
import { AGENT_HEADER, parseKnowledgeScope, SCOPE_HEADER } from '../lib/role';

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
});
