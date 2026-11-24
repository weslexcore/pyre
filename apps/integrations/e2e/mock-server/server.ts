// Mock upstreams for the integrations E2E suite. Started by Playwright's
// webServer (see playwright.config.ts) before `astro dev`, which is pointed
// here by e2e/env.ts:
//
//   /momence/api/v1/*   Momence v1 host-token API (Events)
//   /momence/api/v2/*   Momence v2 host API, including its OAuth token, with
//                       members, sessions, bookings and tags specs add at
//                       runtime (momence-world.ts, driven by e2e/momence.ts)
//   /mailchimp/3.0/*    Mailchimp's audience members (mailchimp.ts)
//   /site/*             the landing site's events and blog feeds
//   /resend/*           Resend: records every email; specs read them back
//                       through mockServerClient(MOCK_URL).requests()
//   /agents/*           pyre-agents (the Eve app): sessions the app opens,
//                       scripted by specs (eve.ts, driven by e2e/eve.ts)
//
// Every route is explicit. A request nothing here answers gets a 404 and is
// recorded as unexpected; the run fails on any (e2e/global-teardown.ts), so a
// wrong path or an operation the mock doesn't know never passes as an empty
// success. Each upstream checks its credentials and the fields that matter,
// answering the way the real service does when they're wrong.
//
// A spec makes one upstream call fail with the `upstream` fixture
// (e2e/test.ts), scoped to its own request so parallel tests are unaffected.
//
// Supabase is not mocked: the suite runs against a real local stack.
// Run on its own with `yarn workspace @pyre/integrations e2e:mock`.

import { type MockRequest, type MockResponse, runMockServer } from '@pyre/e2e-utils/server';
import { MOCK_PORT } from '../ports';
import { eveRoutes } from './eve';
import { mailchimpRoutes } from './mailchimp';
import { momenceEvents } from './momence-fixtures';
import { ACCESS_TOKEN, momenceWorld } from './momence-world';

// The credentials e2e/env.ts gives the app.
const MOMENCE = { hostId: 'e2e', token: 'e2e', clientId: 'e2e', clientSecret: 'e2e' };
const RESEND_KEY = 're_e2e';
/** Addresses the Resend mock has created a contact for. */
const resendContacts = new Set<string>();

/** The OAuth token endpoint takes a form body: a password or refresh grant. */
function issueToken({ body }: MockRequest): MockResponse {
  const form = new URLSearchParams(typeof body === 'string' ? body : '');
  const invalid = (error: string): MockResponse => ({ status: 400, json: { error } });
  if (
    form.get('client_id') !== MOMENCE.clientId ||
    form.get('client_secret') !== MOMENCE.clientSecret
  ) {
    return { status: 401, json: { error: 'invalid_client' } };
  }
  const grant = form.get('grant_type');
  if (grant === 'password') {
    if (!form.get('username') || !form.get('password')) return invalid('invalid_request');
  } else if (grant === 'refresh_token') {
    if (form.get('refresh_token') !== 'e2e-refresh') return invalid('invalid_grant');
  } else {
    return invalid('unsupported_grant_type');
  }
  return {
    json: { access_token: ACCESS_TOKEN, refresh_token: 'e2e-refresh', expires_in: 3600 },
  };
}

const missingKey: MockResponse = {
  status: 401,
  json: { name: 'missing_api_key', message: 'Missing API key' },
};

/** Resend's checks on a send: the API key, then the fields every email needs. */
function resendProblem(headers: MockRequest['headers'], email: unknown): MockResponse | null {
  if (headers.authorization !== `Bearer ${RESEND_KEY}`) return missingKey;
  const { from, to, subject, html, text } = (email ?? {}) as Record<string, unknown>;
  const recipients = [to]
    .flat()
    .filter((r): r is string => typeof r === 'string' && r.includes('@'));
  const missing = [
    !from && 'from',
    recipients.length === 0 && 'to',
    !subject && 'subject',
    !html && !text && 'html or text',
  ].filter(Boolean);
  return missing.length > 0
    ? { status: 422, json: { name: 'validation_error', message: `Missing ${missing.join(', ')}` } }
    : null;
}

let emailId = 0;

await runMockServer({
  port: MOCK_PORT,
  log: Boolean(process.env.MOCK_LOG),
  routes: [
    // -- Momence -------------------------------------------------------------
    {
      path: '/momence/api/v1/Events',
      handler: ({ query }: MockRequest) =>
        query.get('hostId') === MOMENCE.hostId && query.get('token') === MOMENCE.token
          ? { json: momenceEvents() }
          : { status: 401, json: { message: 'Invalid hostId or token' } },
    },
    { method: 'POST', path: '/momence/api/v2/auth/token', handler: issueToken },
    // Members, sessions, bookings and tags that specs added (e2e/momence.ts).
    ...momenceWorld(),
    // -- Mailchimp -----------------------------------------------------------
    ...mailchimpRoutes(),
    // -- pyre-agents (Eve) ---------------------------------------------------
    ...eveRoutes(),
    // -- The landing site (PUBLIC_SITE_URL) ---------------------------------
    { path: '/site/api/events', handler: () => ({ json: [] }) },
    { path: '/site/api/blog-posts.json', handler: () => ({ json: { posts: [] } }) },
    // -- Resend --------------------------------------------------------------
    {
      method: 'POST',
      path: '/resend/emails',
      handler: ({ headers, body }) =>
        resendProblem(headers, body) ?? { json: { id: `e2e-email-${++emailId}` } },
    },
    {
      method: 'POST',
      path: '/resend/emails/batch',
      handler: ({ headers, body }) => {
        if (!Array.isArray(body) || body.length === 0) {
          return { status: 422, json: { name: 'validation_error', message: 'Expected emails' } };
        }
        for (const email of body) {
          const problem = resendProblem(headers, email);
          if (problem) return problem;
        }
        return { json: { data: body.map(() => ({ id: `e2e-email-${++emailId}` })) } };
      },
    },
    // Audience contacts. Created by the Momence member sync and mailing-list
    // sign-ups; a second create for the same address is refused, as Resend
    // refuses a duplicate, so the app falls back to an update.
    {
      // The resend-reconcile job pages the contact list. One page, newest
      // first, like Resend; the mock keeps no unsubscribe flags of its own.
      method: 'GET',
      path: '/resend/contacts',
      handler: ({ headers }) =>
        headers.authorization === `Bearer ${RESEND_KEY}`
          ? {
              json: {
                object: 'list',
                has_more: false,
                data: [...resendContacts].reverse().map((email) => ({
                  id: `e2e-contact-${email}`,
                  email,
                  first_name: null,
                  last_name: null,
                  unsubscribed: false,
                  created_at: new Date(0).toISOString(),
                })),
              },
            }
          : missingKey,
    },
    {
      method: 'POST',
      path: '/resend/contacts',
      handler: ({ headers, body }) => {
        if (headers.authorization !== `Bearer ${RESEND_KEY}`) return missingKey;
        const email = String((body as { email?: unknown })?.email ?? '').toLowerCase();
        if (!email) {
          return { status: 422, json: { name: 'validation_error', message: 'Missing email' } };
        }
        if (resendContacts.has(email)) {
          return { status: 409, json: { name: 'validation_error', message: 'Contact exists' } };
        }
        resendContacts.add(email);
        return { json: { object: 'contact', id: `e2e-contact-${email}` } };
      },
    },
    {
      method: 'POST',
      path: /^\/resend\/contacts\/[^/]+\/segments\/[^/]+$/,
      handler: ({ headers }) =>
        headers.authorization === `Bearer ${RESEND_KEY}`
          ? { json: { id: 'e2e-segment-member' } }
          : missingKey,
    },
    // The unsubscribe and suppression paths mark contacts.
    {
      method: 'PATCH',
      path: /^\/resend\/contacts\/[^/]+$/,
      handler: ({ headers, path }) =>
        headers.authorization === `Bearer ${RESEND_KEY}`
          ? { json: { object: 'contact', id: `e2e-contact-${path.split('/').pop()}` } }
          : missingKey,
    },
  ],
});
