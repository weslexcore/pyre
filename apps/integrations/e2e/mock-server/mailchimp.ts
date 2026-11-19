// Mailchimp's marketing API for the mock server (MAILCHIMP_API_BASE points
// here): one audience, members keyed by the MD5 of their lowercased email, the
// way Mailchimp keys them. Checks the API key and the audience id, so a call
// built wrong fails the way it would against Mailchimp.
//
//   PUT   /mailchimp/3.0/lists/{audience}/members/{hash}        upsert
//   PATCH /mailchimp/3.0/lists/{audience}/members/{hash}        update (404 if unknown)
//   POST  /mailchimp/3.0/lists/{audience}/members/{hash}/tags   set tags (404 if unknown)

import { createHash } from 'node:crypto';
import type { MockRequest, MockResponse, MockRoute } from '@pyre/e2e-utils/server';

/** What e2e/env.ts gives the app. */
export const MAILCHIMP = { apiKey: 'e2e-key-us1', audienceId: 'e2e-audience' } as const;

const BASE = '/mailchimp/3.0';
const MEMBER = new RegExp(`^${BASE}/lists/([^/]+)/members/([0-9a-f]{32})(/tags)?$`);
const STATUSES = ['subscribed', 'unsubscribed', 'cleaned', 'pending', 'transactional'];

export const mailchimpHash = (email: string) =>
  createHash('md5').update(email.toLowerCase()).digest('hex');

const problem = (status: number, detail: string): MockResponse => ({
  status,
  json: { status, title: status === 404 ? 'Resource Not Found' : 'Invalid Resource', detail },
});

export function mailchimpRoutes(): MockRoute[] {
  const members = new Map<string, { email_address: string; status: string }>();
  const basic = `Basic ${Buffer.from(`anystring:${MAILCHIMP.apiKey}`).toString('base64')}`;

  /** Auth, audience and hash checks shared by every member route. */
  const resolve = ({ path, headers }: MockRequest) => {
    if (headers.authorization !== basic) return { error: problem(401, 'API key is invalid') };
    const [, audience, hash] = path.match(MEMBER) ?? [];
    if (audience !== MAILCHIMP.audienceId) return { error: problem(404, 'Audience not found') };
    return { hash };
  };

  return [
    {
      method: 'PUT',
      path: MEMBER,
      handler: (request) => {
        const { error, hash } = resolve(request);
        if (error) return error;
        const body = (request.body ?? {}) as { email_address?: string; status_if_new?: string };
        if (!body.email_address || mailchimpHash(body.email_address) !== hash) {
          return problem(400, 'email_address does not match the member hash');
        }
        const existing = members.get(hash);
        const member = existing ?? {
          email_address: body.email_address,
          status: body.status_if_new ?? 'subscribed',
        };
        members.set(hash, member);
        return { json: { id: hash, ...member } };
      },
    },
    {
      method: 'PATCH',
      path: MEMBER,
      handler: (request) => {
        const { error, hash } = resolve(request);
        if (error) return error;
        const member = members.get(hash);
        if (!member) return problem(404, 'The requested resource could not be found.');
        const { status } = (request.body ?? {}) as { status?: string };
        if (status !== undefined && !STATUSES.includes(status)) return problem(400, 'Bad status');
        if (status) member.status = status;
        return { json: { id: hash, ...member } };
      },
    },
    {
      method: 'POST',
      path: MEMBER,
      handler: (request) => {
        const { error, hash } = resolve(request);
        if (error) return error;
        if (!request.path.endsWith('/tags')) return problem(405, 'Method not allowed');
        if (!members.has(hash)) return problem(404, 'The requested resource could not be found.');
        const { tags } = (request.body ?? {}) as { tags?: unknown };
        if (!Array.isArray(tags)) return problem(400, 'tags must be a list');
        return { status: 204 };
      },
    },
  ];
}
