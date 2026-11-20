// Checks on what the app sent the mock upstreams (mock-server/), for specs
// that care about a side effect outside the database.

import type { RecordedRequest } from '@pyre/e2e-utils';
import { MAILCHIMP, mailchimpHash } from './mock-server/mailchimp';
import { expect, mock } from './test';

/** Requests the mock received that match `method` and `path`. */
export async function upstreamRequests(
  method: string,
  path: string | RegExp
): Promise<RecordedRequest[]> {
  return (await mock.requests()).filter(
    (r) => r.method === method && (typeof path === 'string' ? r.path === path : path.test(r.path))
  );
}

export interface SentEmail {
  to: string | string[];
  cc?: string | string[];
  subject: string;
  html: string;
  tags?: { name: string; value: string }[];
}

/** Emails the Resend mock accepted for `to`, optionally only one template's. */
export async function emailsTo(to: string, template?: string): Promise<SentEmail[]> {
  return (await upstreamRequests('POST', '/resend/emails'))
    .map((r) => r.body as SentEmail)
    .filter(
      (email) =>
        [email.to].flat().includes(to) &&
        (!template || email.tags?.some((t) => t.name === 'template' && t.value === template))
    );
}

/** The first link in an email whose URL matches `pattern`, entity-decoded. */
export function linkIn(email: SentEmail, pattern: RegExp): string | undefined {
  for (const [, href] of email.html.matchAll(/href="([^"]+)"/g)) {
    const url = href.replace(/&amp;/g, '&');
    if (pattern.test(url)) return url;
  }
  return undefined;
}

/**
 * A suppression reaches both mirrors: Mailchimp marks the audience member
 * unsubscribed and Resend marks the contact unsubscribed. The database row is
 * the record; these keep the senders from mailing the address anyway.
 */
export async function expectUnsubscribeMirrored(email: string) {
  const hash = mailchimpHash(email);
  await expect
    .poll(
      async () =>
        (
          await upstreamRequests(
            'PATCH',
            `/mailchimp/3.0/lists/${MAILCHIMP.audienceId}/members/${hash}`
          )
        ).map((r) => r.body),
      { message: `Mailchimp told ${email} unsubscribed` }
    )
    .toContainEqual({ status: 'unsubscribed' });
  await expect
    .poll(
      async () =>
        (await upstreamRequests('PATCH', `/resend/contacts/${email}`)).map(
          (r) => (r.body as { unsubscribed?: boolean }).unsubscribed
        ),
      { message: `Resend told ${email} unsubscribed` }
    )
    .toContain(true);
}
