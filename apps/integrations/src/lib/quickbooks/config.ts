// QuickBooks Online configuration — OAuth2 endpoints and per-environment API
// base URLs, from developer.intuit.com's OAuth 2.0 and API reference docs.
//
// Required env vars (Keys & credentials page of the Intuit app):
//   QUICKBOOKS_CLIENT_ID
//   QUICKBOOKS_CLIENT_SECRET   -- secret; env only, never committed
// Optional:
//   QUICKBOOKS_ENVIRONMENT     -- 'sandbox' (default) or 'production'
//   QUICKBOOKS_REDIRECT_URI    -- override; defaults to
//                                 {request origin}/api/quickbooks/callback,
//                                 which must be listed as a redirect URI on
//                                 the app's Keys page (the quickstart
//                                 playground URI can't receive our callback).

export type QuickBooksEnvironment = 'sandbox' | 'production';

/** Intuit's OAuth2 endpoints are environment-independent. */
export const QBO_AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
export const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
export const QBO_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';

/** Everything the quickstart asked for: Accounting + Payments + OpenID. */
export const QBO_SCOPES =
  'com.intuit.quickbooks.accounting com.intuit.quickbooks.payment openid profile email phone address';

const API_BASES: Record<
  QuickBooksEnvironment,
  { accounting: string; payments: string; userinfo: string }
> = {
  sandbox: {
    accounting: 'https://sandbox-quickbooks.api.intuit.com',
    payments: 'https://sandbox.api.intuit.com',
    userinfo: 'https://sandbox-accounts.platform.intuit.com/v1/openid_connect/userinfo',
  },
  production: {
    accounting: 'https://quickbooks.api.intuit.com',
    payments: 'https://api.intuit.com',
    userinfo: 'https://accounts.platform.intuit.com/v1/openid_connect/userinfo',
  },
};

export function getEnvironment(): QuickBooksEnvironment {
  return import.meta.env.QUICKBOOKS_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
}

export function getApiBases() {
  return API_BASES[getEnvironment()];
}

export interface QuickBooksOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getOAuthConfig(requestUrl?: URL): QuickBooksOAuthConfig {
  const clientId = import.meta.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = import.meta.env.QUICKBOOKS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing QuickBooks OAuth configuration (QUICKBOOKS_CLIENT_ID / QUICKBOOKS_CLIENT_SECRET).'
    );
  }

  const redirectUri =
    import.meta.env.QUICKBOOKS_REDIRECT_URI ??
    (requestUrl ? `${requestUrl.origin}/api/quickbooks/callback` : '');

  return { clientId, clientSecret, redirectUri };
}
