// The bearer check the integrations app authenticates with on every route
// this app serves it: `Authorization: Bearer ${EVE_CHANNEL_SECRET}`. Shared by
// the session channel (agent/channels/eve.ts) and the classify channel
// (agent/channels/classify.ts).

import { type AuthFn, extractBearerToken } from 'eve/channels/auth';

export function channelSecretAuth(): AuthFn<Request> {
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
