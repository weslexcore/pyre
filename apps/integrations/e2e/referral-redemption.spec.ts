// Referral redemption: the landing page relays a friend's /r/{CODE} form here
// (server to server). A first-time customer gets a Momence member with the
// tier's discount tag, a `redeemed` row and an email; everyone else is turned
// away for a reason the form can explain, with nothing written anywhere.
// Each test has its own referrer and friend, so they run in parallel.

import { DESKTOP_ONLY_TAG } from '@pyre/e2e-utils';
import { momence } from './momence';
import { REFERRAL_TIER } from './partners';
import {
  ensureReferralTags,
  friendFor,
  redeem,
  redemptionsFor,
  seedReferrer,
} from './referral-helpers';
import { expect, test } from './test';
import { emailsTo, upstreamRequests } from './upstream';

const MEMBERS = '/momence/api/v2/host/members';

test.describe.configure({ mode: 'parallel' });
test.describe('referral redemption', { tag: DESKTOP_ONLY_TAG }, () => {
  test.beforeAll(ensureReferralTags);

  test('a new customer gets the discount tag, a redeemed row and an email', async ({
    request,
    db,
  }, testInfo) => {
    const referrer = await seedReferrer(db, testInfo);
    const friend = friendFor(testInfo);

    const response = await redeem(request, referrer.code, friend);
    expect(response.status(), await response.text()).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: 'redeemed' });

    const [row] = await redemptionsFor(db, friend.email);
    expect(row).toMatchObject({ status: 'redeemed' });
    const memberId = Number(row.friend_momence_member_id);
    // Momence was asked to create them with what the form collected…
    const created = (await upstreamRequests('POST', MEMBERS)).filter((r) =>
      JSON.stringify(r.body).includes(friend.email)
    );
    expect(created.map((r) => r.body)).toEqual([
      { email: friend.email, firstName: friend.firstName, lastName: friend.lastName },
    ]);
    // …and the member it made carries the tier's tag, which the price rule keys on.
    expect(await momence.member(memberId)).toMatchObject({
      email: friend.email,
      tags: [REFERRAL_TIER.tagName],
    });

    const [email] = await emailsTo(friend.email, 'referral-redeemed');
    expect(email, 'the redemption email').toBeTruthy();
    expect(email.html).toContain(`${REFERRAL_TIER.percent}%`);
    expect(email.html).toContain(`utm_campaign=${referrer.code.toLowerCase()}`);
  });

  test('a second submission is answered, not redeemed again', async ({ request, db }, testInfo) => {
    const referrer = await seedReferrer(db, testInfo);
    const friend = friendFor(testInfo);
    expect((await (await redeem(request, referrer.code, friend)).json()).result).toBe('redeemed');

    const again = await redeem(request, referrer.code, friend);
    expect(again.status()).toBe(200);
    expect(await again.json()).toEqual({ ok: true, result: 'already-redeemed' });

    expect(await redemptionsFor(db, friend.email)).toHaveLength(1);
    expect(await emailsTo(friend.email, 'referral-redeemed')).toHaveLength(1);
  });

  test('two submissions at once redeem once', async ({ request, db }, testInfo) => {
    const referrer = await seedReferrer(db, testInfo);
    const friend = friendFor(testInfo);

    const responses = await Promise.all([
      redeem(request, referrer.code, friend),
      redeem(request, referrer.code, friend),
    ]);
    const results = await Promise.all(responses.map(async (r) => (await r.json()).result));
    expect(results.sort()).toEqual(['already-redeemed', 'redeemed']);

    const rows = await redemptionsFor(db, friend.email);
    expect(rows.map((r) => r.status)).toEqual(['redeemed']);
    expect(await emailsTo(friend.email, 'referral-redeemed')).toHaveLength(1);
  });

  test.describe('policy', () => {
    test('a referrer cannot redeem their own code', async ({ request, db }, testInfo) => {
      const referrer = await seedReferrer(db, testInfo);
      const response = await redeem(request, referrer.code, {
        firstName: 'Rae',
        lastName: 'Referrer',
        email: referrer.email,
      });
      expect(response.status()).toBe(409);
      expect(await response.json()).toEqual({ ok: false, result: 'self-referral' });
      expect(await redemptionsFor(db, referrer.email)).toEqual([]);
    });

    test('someone who has booked before is turned away', async ({ request, db }, testInfo) => {
      const referrer = await seedReferrer(db, testInfo);
      const friend = friendFor(testInfo, 'regular');
      const { id } = await momence.addMember({ ...friend, visits: { total: 3, totalVisits: 3 } });

      const response = await redeem(request, referrer.code, friend);
      expect(response.status()).toBe(409);
      expect(await response.json()).toEqual({ ok: false, result: 'existing-customer' });
      expect(await redemptionsFor(db, friend.email)).toEqual([]);
      expect((await momence.member(id))?.tags).toEqual([]);
      expect(await emailsTo(friend.email)).toEqual([]);
    });

    test('a switched-off referrer gives nothing', async ({ request, db }, testInfo) => {
      const referrer = await seedReferrer(db, testInfo, { enabled: false });
      const friend = friendFor(testInfo);
      const response = await redeem(request, referrer.code, friend);
      expect(response.status()).toBe(409);
      expect(await response.json()).toEqual({ ok: false, result: 'referrer-disabled' });
      expect(await redemptionsFor(db, friend.email)).toEqual([]);
    });

    test('an unknown code is a bad request', async ({ request, db }, testInfo) => {
      const friend = friendFor(testInfo);
      const response = await redeem(request, 'NOSUCHCODE', friend);
      expect(response.status()).toBe(400);
      expect(await response.json()).toEqual({ ok: false, result: 'unknown-code' });
      expect(await redemptionsFor(db, friend.email)).toEqual([]);
    });

    test('a caller without the secret is refused', async ({ request }, testInfo) => {
      const response = await request.post('/api/referral/redeem', {
        data: { code: 'ANYCODE', ...friendFor(testInfo) },
      });
      expect(response.status()).toBe(401);
    });
  });

  test('Momence failing leaves nothing behind, and the retry works', async ({
    request,
    db,
    upstream,
  }, testInfo) => {
    const referrer = await seedReferrer(db, testInfo);
    const friend = friendFor(testInfo);
    // Momence can't create the member: the first request only.
    await upstream.fail({ method: 'POST', path: MEMBERS, bodyIncludes: friend.email, times: 1 });

    const failed = await redeem(request, referrer.code, friend);
    expect(failed.status()).toBe(503);
    expect(await failed.json()).toEqual({ ok: false, error: 'momence-write-failed' });
    // The pending row is dropped so the friend can try again; nothing was sent.
    expect(await redemptionsFor(db, friend.email)).toEqual([]);
    expect(await emailsTo(friend.email)).toEqual([]);

    const retried = await redeem(request, referrer.code, friend);
    expect(await retried.json()).toEqual({ ok: true, result: 'redeemed' });
    const [row] = await redemptionsFor(db, friend.email);
    expect(row.status).toBe('redeemed');
    expect((await momence.member(Number(row.friend_momence_member_id)))?.tags).toEqual([
      REFERRAL_TIER.tagName,
    ]);
  });
});
