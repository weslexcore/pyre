# QuickBooks Online integration (sandbox scaffold)

OAuth 2.0 authorization-code flow against Intuit's sandbox, feeding the
business-overview work. Modules:

- `config.ts` — env config, scopes, per-environment API base URLs
- `oauth.ts` — authorize URL, code exchange, refresh (rotating!), revoke
- `store.ts` — token persistence in the `quickbooks_tokens` Supabase table
- `client.ts` — authenticated fetch with proactive refresh + sample calls

Routes (all admin-gated by the Momence session):

| Route | What it does |
| --- | --- |
| `GET /api/quickbooks/connect` | Redirects to Intuit's consent screen |
| `GET /api/quickbooks/callback` | Exchanges `?code=&realmId=` for tokens, stores them |
| `GET /api/quickbooks/status` | Connection summary (no token material) |
| `DELETE /api/quickbooks/status` | Revokes the grant and deletes the row |
| `GET /api/quickbooks/company-info` | Accounting API CompanyInfo |
| `GET /api/quickbooks/userinfo` | OpenID Connect userinfo |
| `POST /api/quickbooks/test-charge` | Payments API charge (sandbox-only; defaults to Intuit's test Visa) |

## Setup

1. On the Intuit app's **Keys & credentials** page (Development keys), copy the
   client id/secret and add the callback as a redirect URI —
   `http://localhost:4321/api/quickbooks/callback` for local dev, plus the
   deployed origin's equivalent. The quickstart playground URI can't receive
   our callback.
2. Env vars (`.env` locally, Vercel project settings when deployed):

   ```sh
   QUICKBOOKS_CLIENT_ID=...
   QUICKBOOKS_CLIENT_SECRET=...   # secret — env only, never committed
   QUICKBOOKS_ENVIRONMENT=sandbox # optional; sandbox is the default
   # QUICKBOOKS_REDIRECT_URI=...  # optional override of {origin}/api/quickbooks/callback
   ```

3. Apply the `quickbooks_tokens` migration:
   `yarn workspace @pyre/supabase migrate` (local) / `db:push` (hosted).

## Run it

```sh
nvm use && yarn install --immutable
yarn dev:integrations   # or: yarn workspace @pyre/integrations dev
```

Then, signed in as an admin:

1. Open `http://localhost:4321/api/quickbooks/connect`, sign in to the Intuit
   developer account, and pick the sandbox company. The callback stores tokens
   and echoes the realm id.
2. `curl` (or open) the sample routes with your browser session cookie:
   `/api/quickbooks/company-info`, `/api/quickbooks/userinfo`, and
   `POST /api/quickbooks/test-charge`.

Token lifecycle: access tokens last ~1 hour and are refreshed automatically
5 minutes before expiry (plus one forced-refresh retry on 401). Refresh tokens
last ~100 days and **rotate on every refresh** — the store persists the rotated
token immediately, and if it ever lapses the API returns 409 and an admin
re-runs `/connect`.
