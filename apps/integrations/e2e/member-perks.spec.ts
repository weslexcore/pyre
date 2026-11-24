// Member perks: a Pyre member asks, on the landing page's /perks, for us to
// vouch for them at a partner. The landing page relays partner + email here;
// we email the member a confirm link, and only when they use it do we check
// Momence and email the partner's desk that the membership is valid. Each test
// has its own member; the partners are seeded by auth.setup.ts (partners.ts).

import type { APIRequestContext, TestInfo } from '@playwright/test';
import { DESKTOP_ONLY_TAG, uniqueEmail } from '@pyre/e2e-utils';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SECRETS } from './env';
import { momence } from './momence';
import { PARTNER, PARTNER_OFF } from './partners';
import { expect, test } from './test';
import { emailsTo, linkIn } from './upstream';

const CONFIRM_LINK = /\/api\/partner\/member-confirm\?token=/;

function submit(request: APIRequestContext, email: string, partner: string = PARTNER.slug) {
  return request.post('/api/partner/member-request', {
    headers: { authorization: `Bearer ${SECRETS.partner}` },
    data: { partner, email },
  });
}

interface Row {
  status: string;
  member_name: string | null;
  membership_name: string | null;
  notified_count: number;
}

async function rowsFor(db: SupabaseClient, email: string): Promise<Row[]> {
  const { data, error } = await db
    .from('partner_member_verifications')
    .select('status, member_name, membership_name, notified_count')
    .eq('member_email', email);
  expect(error).toBeNull();
  return (data ?? []) as Row[];
}

/** The confirm link in the one email the member got, as a path on this app. */
async function confirmLink(email: string): Promise<string> {
  const sent = await emailsTo(email, 'partner-member-confirm');
  expect(sent, 'one confirm email to the member').toHaveLength(1);
  const href = linkIn(sent[0], CONFIRM_LINK);
  expect(href, 'a confirm link').toBeTruthy();
  const url = new URL(href ?? '');
  return url.pathname + url.search;
}

/** Click the link: GET shows the button, the button POSTs the token back. */
async function confirm(request: APIRequestContext, link: string) {
  const shown = await request.get(link);
  expect(shown.status()).toBe(200);
  const html = await shown.text();
  const token = html.match(/name="token" value="([^"]+)"/)?.[1];
  expect(token, 'the button carries the token').toBeTruthy();
  return request.post('/api/partner/member-confirm', { form: { token: token ?? '' } });
}

/** What the partner desk got about this member. */
async function deskEmails(memberEmail: string) {
  return (await emailsTo(PARTNER.contact, 'partner-member-verified')).filter((e) =>
    e.html.includes(memberEmail)
  );
}

async function addMember(testInfo: TestInfo, label: string) {
  const email = uniqueEmail(testInfo, label);
  const { id } = await momence.addMember({ firstName: 'Mara', lastName: 'Member', email });
  return { id, email };
}

test.describe.configure({ mode: 'parallel' });
test.describe('member perks', { tag: DESKTOP_ONLY_TAG }, () => {
  test('an active member confirms: the partner is told their membership is valid', async ({
    request,
    db,
  }, testInfo) => {
    const member = await addMember(testInfo, 'perk-member');
    await momence.addMembership({ memberId: member.id, name: 'Founding Unlimited' });

    const response = await submit(request, member.email.toUpperCase());
    expect(response.status(), await response.text()).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    // Nothing reaches the partner before the member clicks.
    expect(await rowsFor(db, member.email)).toMatchObject([{ status: 'awaiting_confirmation' }]);
    expect(await deskEmails(member.email)).toEqual([]);
    const link = await confirmLink(member.email);

    // Opening the link (as a mail scanner would) sends nothing by itself.
    await request.get(link);
    expect(await deskEmails(member.email)).toEqual([]);

    const done = await confirm(request, link);
    expect(done.status()).toBe(200);
    expect(await done.text()).toContain(`let ${PARTNER.name} know`);

    const [desk] = await deskEmails(member.email);
    expect(desk, 'the partner desk was emailed').toBeTruthy();
    expect(desk.html).toContain('Mara Member');
    expect(desk.html).toContain('Founding Unlimited');
    expect(desk.html).toContain(PARTNER.memberPerk);
    expect(await rowsFor(db, member.email)).toMatchObject([
      {
        status: 'verified',
        member_name: 'Mara Member',
        membership_name: 'Founding Unlimited',
        notified_count: 1,
      },
    ]);

    // A second click sends nothing more.
    const again = await confirm(request, link);
    expect(await again.text()).toContain(`let ${PARTNER.name} know`);
    expect(await deskEmails(member.email)).toHaveLength(1);
  });

  test('a credit pack is not a membership: the partner hears nothing', async ({
    request,
    db,
  }, testInfo) => {
    const member = await addMember(testInfo, 'perk-pack');
    await momence.addMembership({ memberId: member.id, name: '5 Pack', type: 'package-events' });

    expect((await submit(request, member.email)).status()).toBe(200);
    const done = await confirm(request, await confirmLink(member.email));
    expect(await done.text()).toContain("couldn't find an active Pyre membership");
    expect(await rowsFor(db, member.email)).toMatchObject([{ status: 'not_member' }]);
    expect(await deskEmails(member.email)).toEqual([]);
  });

  test('a frozen membership does not count', async ({ request, db }, testInfo) => {
    const member = await addMember(testInfo, 'perk-frozen');
    await momence.addMembership({ memberId: member.id, name: 'Unlimited', isFrozen: true });

    expect((await submit(request, member.email)).status()).toBe(200);
    await confirm(request, await confirmLink(member.email));
    expect(await rowsFor(db, member.email)).toMatchObject([{ status: 'not_member' }]);
    expect(await deskEmails(member.email)).toEqual([]);
  });

  test('an email Momence has never seen still gets a link, and the partner hears nothing', async ({
    request,
    db,
  }, testInfo) => {
    // Answering the same way for a stranger keeps the form from revealing who
    // is a member: only the inbox's owner learns the result.
    const email = uniqueEmail(testInfo, 'perk-stranger');
    expect((await submit(request, email)).status()).toBe(200);
    const done = await confirm(request, await confirmLink(email));
    expect(await done.text()).toContain("couldn't find an active Pyre membership");
    expect(await rowsFor(db, email)).toMatchObject([{ status: 'not_member' }]);
  });

  test('a repeat request inside the link lifetime sends no second email', async ({
    request,
    db,
  }, testInfo) => {
    const email = uniqueEmail(testInfo, 'perk-repeat');
    expect((await submit(request, email)).status()).toBe(200);
    expect((await submit(request, email)).status()).toBe(200);
    expect(await emailsTo(email, 'partner-member-confirm')).toHaveLength(1);
    expect(await rowsFor(db, email)).toHaveLength(1);
  });

  test('a forged or tampered link does nothing', async ({ request }) => {
    const res = await request.post('/api/partner/member-confirm', {
      form: { token: 'not-a-token' },
    });
    expect(res.status()).toBe(400);
  });

  test.describe('policy', () => {
    test('a switched-off partner takes no requests', async ({ request, db }, testInfo) => {
      const email = uniqueEmail(testInfo, 'perk-off');
      const response = await submit(request, email, PARTNER_OFF.slug);
      expect(response.status()).toBe(403);
      expect(await rowsFor(db, email)).toEqual([]);
      expect(await emailsTo(email)).toEqual([]);
    });

    test('an unknown partner is a bad request', async ({ request }, testInfo) => {
      const response = await submit(request, uniqueEmail(testInfo, 'perk-unknown'), 'nope');
      expect(response.status()).toBe(400);
    });

    test('the intake needs the shared secret', async ({ request }, testInfo) => {
      const response = await request.post('/api/partner/member-request', {
        data: { partner: PARTNER.slug, email: uniqueEmail(testInfo, 'perk-anon') },
      });
      expect(response.status()).toBe(401);
    });
  });
});
