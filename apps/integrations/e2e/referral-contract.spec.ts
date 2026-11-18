// The referral lookup the landing page calls server-side for /r/{CODE}. Its
// answer must match the shared contract (@pyre/e2e-utils contracts/referral),
// which the landing page's suite serves from its mock of this service.

import { DESKTOP_ONLY_TAG, REFERRAL, REFERRAL_UNKNOWN } from '@pyre/e2e-utils';
import { SECRETS } from './env';
import { expect, test } from './test';

const auth = { authorization: `Bearer ${SECRETS.referral}` };

test.describe('referral lookup', { tag: DESKTOP_ONLY_TAG }, () => {
  test.beforeAll(async ({ db }) => {
    // The contract's referrer, seeded idempotently (the stack is reused
    // across local runs). Its tier must exist first.
    const tier = await db.from('referral_tiers').upsert({
      percent: REFERRAL.discountPercent,
      tag_name: `referral-${REFERRAL.discountPercent}`,
    });
    expect(tier.error).toBeNull();
    const referrer = await db.from('referrers').upsert(
      {
        code: REFERRAL.code,
        display_name: REFERRAL.displayName,
        discount_percent: REFERRAL.discountPercent,
        referrer_type: REFERRAL.referrerType,
        momence_member_id: 990_001,
        enabled: true,
      },
      { onConflict: 'code' }
    );
    expect(referrer.error).toBeNull();
  });

  test('answers a known code with the shared contract', async ({ request }) => {
    const response = await request.get(`/api/referral/lookup?code=${REFERRAL.code}`, {
      headers: auth,
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual(REFERRAL);
  });

  test('folds case, answering with the canonical code', async ({ request }) => {
    const response = await request.get(`/api/referral/lookup?code=${REFERRAL.code.toLowerCase()}`, {
      headers: auth,
    });
    expect(await response.json()).toEqual(REFERRAL);
  });

  test('answers an unknown code the way the contract says', async ({ request }) => {
    const response = await request.get('/api/referral/lookup?code=NOSUCHCODE', { headers: auth });
    expect(response.status()).toBe(404);
    expect(await response.json()).toEqual(REFERRAL_UNKNOWN);
  });

  test('refuses a caller without the secret', async ({ request }) => {
    expect((await request.get(`/api/referral/lookup?code=${REFERRAL.code}`)).status()).toBe(401);
  });
});
