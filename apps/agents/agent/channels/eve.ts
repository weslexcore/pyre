// Inbound auth for the HTTP session API (POST /eve/v1/session): the
// integrations app's "Draft schedule" endpoint calls with
// `Authorization: Bearer ${EVE_CHANNEL_SECRET}`. Vercel OIDC covers CLI /
// internal-deployment access; localDev keeps `eve dev` open locally.

import { type AuthFn, extractBearerToken, localDev, vercelOidc } from 'eve/channels/auth';
import { eveChannel } from 'eve/channels/eve';

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
});
