// Partner verification: the landing page relays a customer's "I'm a member at
// <partner>" form here. The partner's desk is emailed signed confirm/deny
// links; confirming tags the customer in Momence (the partner price rule keys
// on the tag) and tells them, denying tells them no. Each test has its own
// customer; the partners are seeded by auth.setup.ts (partners.ts).

import type { APIRequestContext, TestInfo } from '@playwright/test';
import { DESKTOP_ONLY_TAG, uniqueEmail } from '@pyre/e2e-utils';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SECRETS } from './env';
import { momence } from './momence';
import { PARTNER, PARTNER_OFF } from './partners';
import { ADMIN, STAFF } from './roles';
import { expect, test } from './test';
import { emailsTo, upstreamRequests } from './upstream';

const MEMBERS = '/momence/api/v2/host/members';
const DECISION_LINK = /\/api\/partner\/decision\?token=/;

interface Customer {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

function customerFor(testInfo: TestInfo): Customer {
  return {
    firstName: 'Cam',
    lastName: 'Climber',
    email: uniqueEmail(testInfo, 'partner-customer'),
    phone: '(804) 555-0142',
  };
}

function submit(request: APIRequestContext, customer: Customer, partner: string = PARTNER.slug) {
  return request.post('/api/partner/request', {
    headers: { authorization: `Bearer ${SECRETS.partner}` },
    data: { partner, ...customer },
  });
}

interface VerificationRow {
  id: string;
  status: string;
  notified_count: number;
  momence_member_id: string | null;
  decided_at: string | null;
}

async function requestsFor(db: SupabaseClient, email: string): Promise<VerificationRow[]> {
  const { data, error } = await db
    .from('partner_verifications')
    .select('id, status, notified_count, momence_member_id, decided_at')
    .eq('customer_email', email);
  expect(error).toBeNull();
  return (data ?? []) as VerificationRow[];
}

/** The confirm and deny links in the email the partner's desk got about `customer`. */
async function deskLinks(customer: Customer) {
  const emails = (await emailsTo(PARTNER.contact, 'partner-verification-request')).filter((e) =>
    e.html.includes(customer.email)
  );
  expect(emails, 'one email to the partner desk').toHaveLength(1);
  const links = [...emails[0].html.matchAll(/href="([^"]+)"/g)]
    .map(([, href]) => href.replace(/&amp;/g, '&'))
    .filter((href) => DECISION_LINK.test(href));
  const [confirm, deny] = [...new Set(links)];
  expect(confirm && deny, 'a confirm and a deny link').toBeTruthy();
  // The page that renders the email uses absolute links to this app.
  const path = (href: string) => new URL(href).pathname + new URL(href).search;
  return { confirm: path(confirm), deny: path(deny), html: emails[0].html };
}

test.describe.configure({ mode: 'parallel' });
test.describe('partner verification', { tag: DESKTOP_ONLY_TAG }, () => {
  test.beforeAll(async () => {
    await momence.addTag(PARTNER.tagName);
  });

  test('the partner confirms: the customer is tagged and told', async ({
    request,
    db,
  }, testInfo) => {
    const customer = customerFor(testInfo);
    const response = await submit(request, customer);
    expect(response.status(), await response.text()).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const [pending] = await requestsFor(db, customer.email);
    expect(pending).toMatchObject({ status: 'pending', notified_count: 1 });
    const { confirm, html } = await deskLinks(customer);
    expect(html).toContain('8045550142');

    const page = await request.get(confirm);
    expect(page.status()).toBe(200);
    expect(await page.text()).toContain('Confirmed');

    const [confirmed] = await requestsFor(db, customer.email);
    expect(confirmed.status).toBe('confirmed');
    expect(Date.parse(confirmed.decided_at ?? '')).not.toBeNaN();
    // A new Momence member, created with the form's details and tagged.
    const member = await momence.member(Number(confirmed.momence_member_id));
    expect(member).toMatchObject({
      email: customer.email,
      firstName: customer.firstName,
      phoneNumber: '8045550142',
      tags: [PARTNER.tagName],
    });
    const [told] = await emailsTo(customer.email, 'partner-verified');
    expect(told?.html).toContain(`${PARTNER.discountPercent}%`);

    // The link is single-use, and the deny link no longer does anything.
    const again = await request.get(confirm);
    expect(await again.text()).toContain('Already handled');
    expect(await emailsTo(customer.email, 'partner-verified')).toHaveLength(1);
  });

  test('the partner denies: no tag, and the customer is told', async ({
    request,
    db,
  }, testInfo) => {
    const customer = customerFor(testInfo);
    expect((await submit(request, customer)).status()).toBe(200);
    const { deny, confirm } = await deskLinks(customer);

    const page = await request.get(deny);
    expect(page.status()).toBe(200);
    expect(await page.text()).toContain('Noted');
    const [denied] = await requestsFor(db, customer.email);
    expect(denied).toMatchObject({ status: 'denied', momence_member_id: null });
    expect(await emailsTo(customer.email, 'partner-denied')).toHaveLength(1);
    // Momence was never asked to create or tag anyone for them.
    const created = (await upstreamRequests('POST', MEMBERS)).filter((r) =>
      JSON.stringify(r.body).includes(customer.email)
    );
    expect(created).toEqual([]);

    // Confirming after a denial changes nothing.
    expect(await (await request.get(confirm)).text()).toContain('Already handled');
    expect((await requestsFor(db, customer.email))[0].status).toBe('denied');
  });

  test('submitting again does not email the partner again', async ({ request, db }, testInfo) => {
    const customer = customerFor(testInfo);
    expect((await submit(request, customer)).status()).toBe(200);
    const again = await submit(request, customer);
    // Indistinguishable from the first, so the form can't probe request state.
    expect(again.status()).toBe(200);
    expect(await again.json()).toEqual({ ok: true });

    expect(await requestsFor(db, customer.email)).toHaveLength(1);
    await deskLinks(customer); // exactly one email
  });

  test.describe('policy', () => {
    test('a switched-off partner takes no requests', async ({ request, db }, testInfo) => {
      const customer = customerFor(testInfo);
      const response = await submit(request, customer, PARTNER_OFF.slug);
      expect(response.status()).toBe(403);
      expect(await response.json()).toEqual({ error: 'partner-disabled' });
      expect(await requestsFor(db, customer.email)).toEqual([]);
      expect(await emailsTo(PARTNER_OFF.contact)).toEqual([]);
    });

    test('an unknown partner is a bad request', async ({ request, db }, testInfo) => {
      const customer = customerFor(testInfo);
      const response = await submit(request, customer, 'no-such-partner');
      expect(response.status()).toBe(400);
      expect(await requestsFor(db, customer.email)).toEqual([]);
    });

    test('a phone number is required', async ({ request }, testInfo) => {
      const response = await submit(request, { ...customerFor(testInfo), phone: 'call me' });
      expect(response.status()).toBe(400);
      expect(await response.json()).toEqual({ error: 'Invalid phone' });
    });

    test('a caller without the secret is refused', async ({ request }, testInfo) => {
      const response = await request.post('/api/partner/request', {
        data: { partner: PARTNER.slug, ...customerFor(testInfo) },
      });
      expect(response.status()).toBe(401);
    });

    test('a forged decision link is refused', async ({ request }) => {
      const response = await request.get('/api/partner/decision?token=not.a-real-token');
      expect(response.status()).toBe(400);
    });
  });

  test.describe('when an upstream fails', () => {
    test('the partner email failing drops the request, so the retry gets through', async ({
      request,
      db,
      upstream,
    }, testInfo) => {
      const customer = customerFor(testInfo);
      // The desk's email carries the customer's address; fail that one send.
      await upstream.fail({
        method: 'POST',
        path: '/resend/emails',
        bodyIncludes: customer.email,
        status: 500,
        times: 1,
      });

      const failed = await submit(request, customer);
      expect(failed.status()).toBe(503);
      expect(await failed.json()).toEqual({ error: 'partner-email-failed' });
      expect(await requestsFor(db, customer.email)).toEqual([]);

      expect((await submit(request, customer)).status()).toBe(200);
      expect((await requestsFor(db, customer.email))[0]).toMatchObject({
        status: 'pending',
        notified_count: 1,
      });
    });

    test('Momence failing on confirm keeps the request pending; the link works again', async ({
      request,
      db,
      upstream,
    }, testInfo) => {
      const customer = customerFor(testInfo);
      expect((await submit(request, customer)).status()).toBe(200);
      const { confirm } = await deskLinks(customer);
      await upstream.fail({
        method: 'POST',
        path: MEMBERS,
        bodyIncludes: customer.email,
        times: 1,
      });

      const failed = await request.get(confirm);
      expect(failed.status()).toBe(500);
      expect(await failed.text()).toContain('Something went wrong');
      expect((await requestsFor(db, customer.email))[0]).toMatchObject({
        status: 'pending',
        momence_member_id: null,
      });
      expect(await emailsTo(customer.email, 'partner-verified')).toEqual([]);

      const retried = await request.get(confirm);
      expect(await retried.text()).toContain('Confirmed');
      const [row] = await requestsFor(db, customer.email);
      expect(row.status).toBe('confirmed');
      expect((await momence.member(Number(row.momence_member_id)))?.tags).toEqual([
        PARTNER.tagName,
      ]);
    });
  });

  // /admin/partners: the queue staff work when a partner's desk is slow.
  test.describe('the admin queue', () => {
    const act = (admin: APIRequestContext, id: string, action: string) =>
      admin.post('/api/admin/partner-requests', { data: { id, action } });

    test('an admin finds a request and confirms it for the partner', async ({
      request,
      as,
      db,
    }, testInfo) => {
      const customer = customerFor(testInfo);
      expect((await submit(request, customer)).status()).toBe(200);
      const admin = await as(ADMIN);

      const list = await admin.get(
        `/api/admin/partner-requests?status=pending&q=${encodeURIComponent(customer.email)}`
      );
      expect(list.status()).toBe(200);
      const { requests, counts } = (await list.json()) as {
        requests: { id: string; customer_email: string; status: string }[];
        counts: Record<string, number>;
      };
      expect(requests.map((r) => [r.customer_email, r.status])).toEqual([
        [customer.email, 'pending'],
      ]);
      expect(counts.pending).toBeGreaterThanOrEqual(1);

      const confirmed = await act(admin, requests[0].id, 'confirm');
      expect(confirmed.status(), await confirmed.text()).toBe(200);
      expect(await confirmed.json()).toEqual({ ok: true, outcome: 'confirmed' });
      const { data, error } = await db
        .from('partner_verifications')
        .select('status, decided_by, momence_member_id')
        .eq('id', requests[0].id)
        .single();
      expect(error).toBeNull();
      // On the record as the admin's decision, not the partner's.
      expect(data).toMatchObject({ status: 'confirmed', decided_by: ADMIN.email });
      expect((await momence.member(Number(data?.momence_member_id)))?.tags).toEqual([
        PARTNER.tagName,
      ]);
      expect(await emailsTo(customer.email, 'partner-verified')).toHaveLength(1);

      // A second decision, or the partner's own link afterwards, changes nothing.
      expect((await act(admin, requests[0].id, 'deny')).status()).toBe(409);
      const { confirm } = await deskLinks(customer);
      expect(await (await request.get(confirm)).text()).toContain('Already handled');
      expect(await emailsTo(customer.email, 'partner-denied')).toEqual([]);
    });

    test('re-sending to the partner is throttled, then goes out with the same request', async ({
      request,
      as,
      db,
    }, testInfo) => {
      const customer = customerFor(testInfo);
      expect((await submit(request, customer)).status()).toBe(200);
      const [{ id }] = await requestsFor(db, customer.email);
      const admin = await as(ADMIN);

      // Just sent: a double click can't spam the partner.
      const tooSoon = await act(admin, id, 'resend');
      expect(tooSoon.status()).toBe(429);
      expect((await tooSoon.json()).retryAfterSeconds).toBeGreaterThan(0);

      // Ten minutes on, it goes out again.
      const { error } = await db
        .from('partner_verifications')
        .update({ last_notified_at: new Date(Date.now() - 10 * 60_000).toISOString() })
        .eq('id', id);
      expect(error).toBeNull();
      const resent = await act(admin, id, 'resend');
      expect(resent.status(), await resent.text()).toBe(200);
      const desk = (await emailsTo(PARTNER.contact, 'partner-verification-request')).filter((e) =>
        e.html.includes(customer.email)
      );
      expect(desk).toHaveLength(2);
      // Still one request, still pending; either email's links decide it.
      expect(await requestsFor(db, customer.email)).toEqual([
        expect.objectContaining({ id, status: 'pending', notified_count: 1 }),
      ]);
    });

    test('an admin can deny; a decided request cannot be re-sent', async ({
      request,
      as,
      db,
    }, testInfo) => {
      const customer = customerFor(testInfo);
      expect((await submit(request, customer)).status()).toBe(200);
      const [{ id }] = await requestsFor(db, customer.email);
      const admin = await as(ADMIN);

      expect(await (await act(admin, id, 'deny')).json()).toEqual({ ok: true, outcome: 'denied' });
      expect(await emailsTo(customer.email, 'partner-denied')).toHaveLength(1);
      expect((await act(admin, id, 'resend')).status()).toBe(409);
      expect((await act(admin, id, 'archive')).status()).toBe(400);
    });

    test('staff without the partners page can neither read nor act on the queue', async ({
      request,
      as,
      db,
    }, testInfo) => {
      const customer = customerFor(testInfo);
      expect((await submit(request, customer)).status()).toBe(200);
      const [{ id }] = await requestsFor(db, customer.email);
      const staff = await as(STAFF);

      expect((await staff.get('/api/admin/partner-requests')).status()).toBe(403);
      expect((await act(staff, id, 'confirm')).status()).toBe(403);
      expect((await requestsFor(db, customer.email))[0].status).toBe('pending');
    });
  });
});
