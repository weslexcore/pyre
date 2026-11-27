// Inbound webhooks and the cron tick: each refuses a delivery it can't
// verify, acts on one it can, and acting twice on the same delivery (senders
// retry) changes nothing more. Server-to-server only, so desktop only.

import { DESKTOP_ONLY_TAG, uniqueEmail, uniqueTag } from '@pyre/e2e-utils';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SECRETS } from './env';
import { momence, sessionAround } from './momence';
import { PARTNER, REFERRAL_TIER } from './partners';
import {
  ensureReferralTags,
  friendFor,
  REWARD_TAG,
  redeem,
  redemptionsFor,
  seedReferrer,
} from './referral-helpers';
import { mailchimpDelivery, momenceDelivery, resendDelivery } from './signing';
import { expect, test } from './test';
import { emailsTo, expectUnsubscribeMirrored } from './upstream';

const MOMENCE_HOOK = '/api/webhooks/momence';

interface CheckInRow {
  booking_id: string;
  session_id: string;
  member_id: string | null;
  checked_in_at: string;
  checked_out_at: string | null;
  updated_by: string;
  updated_at: string;
}

async function checkInsFor(db: SupabaseClient, bookingId: number): Promise<CheckInRow[]> {
  const { data, error } = await db
    .from('guest_floor_checkins')
    .select(
      'booking_id, session_id, member_id, checked_in_at, checked_out_at, updated_by, updated_at'
    )
    .eq('booking_id', String(bookingId));
  expect(error).toBeNull();
  return (data ?? []) as CheckInRow[];
}

async function rewardsFor(db: SupabaseClient, redemptionId: string) {
  const { data, error } = await db
    .from('referral_rewards')
    .select('id, status, reward_tag_name')
    .eq('redemption_id', redemptionId);
  expect(error).toBeNull();
  return data ?? [];
}

test.describe.configure({ mode: 'parallel' });
test.describe('webhooks', { tag: DESKTOP_ONLY_TAG }, () => {
  test.describe('Momence', () => {
    test('a check-in records its time once, however often it is delivered', async ({
      request,
      db,
    }, testInfo) => {
      const guest = await momence.addMember({
        firstName: 'Gale',
        lastName: uniqueTag(testInfo, 'Guest'),
        email: uniqueEmail(testInfo, 'checkin'),
      });
      const session = await momence.addSession({ name: 'Social', ...sessionAround(-10) });
      const booking = await momence.addBooking({ sessionId: session.id, memberId: guest.id });
      const checkedInAt = new Date(Date.now() - 5 * 60_000).toISOString();
      const payload = {
        sessionBookingId: booking.id,
        sessionId: session.id,
        memberId: guest.id,
        checkedInAt,
      };
      const delivery = momenceDelivery('session-booking-checked-in', payload);

      const response = await request.post(MOMENCE_HOOK, delivery);
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({ success: true });
      const [row, ...extra] = await checkInsFor(db, booking.id);
      expect(extra).toEqual([]);
      expect(row).toMatchObject({
        checked_out_at: null,
        // Written by the webhook, not by someone on the floor.
        updated_by: 'momence',
      });
      expect(String(row.session_id)).toBe(String(session.id));
      expect(String(row.member_id)).toBe(String(guest.id));
      expect(Date.parse(row.checked_in_at)).toBe(Date.parse(checkedInAt));

      // Momence retries the same delivery: nothing changes.
      expect((await request.post(MOMENCE_HOOK, delivery)).status()).toBe(200);
      expect(await checkInsFor(db, booking.id)).toEqual([row]);

      // A stale delivery carrying an earlier time doesn't wind the clock back.
      const earlier = momenceDelivery('session-booking-checked-in', {
        ...payload,
        checkedInAt: new Date(Date.parse(checkedInAt) - 60 * 60_000).toISOString(),
      });
      expect((await request.post(MOMENCE_HOOK, earlier)).status()).toBe(200);
      expect(await checkInsFor(db, booking.id)).toEqual([row]);
    });

    test("a referred friend's first booking converts the referral and rewards the referrer, once", async ({
      request,
      db,
    }, testInfo) => {
      await ensureReferralTags();
      const referrer = await seedReferrer(db, testInfo);
      const friend = friendFor(testInfo);
      expect((await (await redeem(request, referrer.code, friend)).json()).result).toBe('redeemed');
      const [redeemed] = await redemptionsFor(db, friend.email);
      const friendId = Number(redeemed.friend_momence_member_id);
      expect((await momence.member(friendId))?.tags).toEqual([REFERRAL_TIER.tagName]);

      // The friend books their first session.
      const session = await momence.addSession({ name: 'Social', ...sessionAround(24 * 60) });
      const booking = await momence.addBooking({ sessionId: session.id, memberId: friendId });
      const booked = momenceDelivery('session-booked', {
        sessionId: session.id,
        sessionBookingId: booking.id,
        payingMemberId: friendId,
        targetMemberId: friendId,
      });
      const response = await request.post(MOMENCE_HOOK, booked);
      expect(response.status(), await response.text()).toBe(200);

      const [converted] = await redemptionsFor(db, friend.email);
      expect(converted.status).toBe('converted');
      expect(String(converted.converted_session_booking_id)).toBe(String(booking.id));
      // Their discount tag comes off; the referrer gets the reward tag, a
      // ledger row and an email.
      expect((await momence.member(friendId))?.tags).toEqual([]);
      expect((await momence.member(referrer.memberId))?.tags).toEqual([REWARD_TAG]);
      expect(await rewardsFor(db, redeemed.id)).toEqual([
        expect.objectContaining({ status: 'granted', reward_tag_name: REWARD_TAG }),
      ]);
      await expect
        .poll(async () => (await emailsTo(referrer.email, 'referral-reward-earned')).length)
        .toBe(1);

      // Momence redelivers the booking: still one conversion, one reward, one email.
      expect((await request.post(MOMENCE_HOOK, booked)).status()).toBe(200);
      expect((await redemptionsFor(db, friend.email)).map((r) => r.status)).toEqual(['converted']);
      expect(await rewardsFor(db, redeemed.id)).toHaveLength(1);
      expect(await emailsTo(referrer.email, 'referral-reward-earned')).toHaveLength(1);

      // The converting booking is cancelled: the redemption is flagged for an
      // admin, once, and the reward stands.
      const cancelled = momenceDelivery('session-booking-cancelled', {
        sessionId: session.id,
        sessionBookingId: booking.id,
        payingMemberId: friendId,
        targetMemberId: friendId,
        cancelledAt: new Date().toISOString(),
      });
      expect((await request.post(MOMENCE_HOOK, cancelled)).status()).toBe(200);
      const [flagged] = await redemptionsFor(db, friend.email);
      expect(flagged.status).toBe('converted');
      expect(Date.parse(flagged.cancelled_at ?? '')).not.toBeNaN();
      expect((await request.post(MOMENCE_HOOK, cancelled)).status()).toBe(200);
      expect((await redemptionsFor(db, friend.email))[0].cancelled_at).toBe(flagged.cancelled_at);
      expect(await rewardsFor(db, redeemed.id)).toEqual([
        expect.objectContaining({ status: 'granted' }),
      ]);
    });

    test('acknowledges an event it does not act on', async ({ request }) => {
      const delivery = momenceDelivery('session-created', { sessionId: 1 });
      const response = await request.post(MOMENCE_HOOK, delivery);
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({ success: true });
    });

    test('refuses a wrong shared secret, and writes nothing', async ({ request, db }) => {
      const delivery = momenceDelivery('session-booking-checked-in', {
        sessionBookingId: 7_999_999_001,
        sessionId: 7_999_999_002,
        memberId: 7_999_999_003,
        checkedInAt: new Date().toISOString(),
      });
      const response = await request.post(MOMENCE_HOOK, {
        ...delivery,
        headers: { ...delivery.headers, 'x-webhook-secret': 'wrong' },
      });
      expect(response.status()).toBe(401);
      expect(await checkInsFor(db, 7_999_999_001)).toEqual([]);
    });

    test('refuses a bad signature', async ({ request }) => {
      const delivery = momenceDelivery('session-created', { sessionId: 1 }, 'wrong-key');
      expect((await request.post(MOMENCE_HOOK, delivery)).status()).toBe(401);
    });
  });

  test.describe('Mailchimp', () => {
    test('an unsubscribe suppresses the address', async ({ request, db }, testInfo) => {
      const email = uniqueEmail(testInfo, 'mailchimp');
      const delivery = mailchimpDelivery({ type: 'unsubscribe', 'data[email]': email });
      expect((await request.post(delivery.url, delivery)).status()).toBe(200);

      const { data, error } = await db
        .from('email_suppressions')
        .select('reason, source')
        .eq('email', email);
      expect(error).toBeNull();
      expect(data).toEqual([{ reason: 'unsubscribe', source: 'mailchimp-webhook' }]);
      // Both senders are told (Mailchimp, where it came from, harmlessly so).
      await expectUnsubscribeMirrored(email);
    });

    test('refuses a bad signature', async ({ request, db }, testInfo) => {
      const email = uniqueEmail(testInfo, 'mailchimp-forged');
      const delivery = mailchimpDelivery(
        { type: 'unsubscribe', 'data[email]': email },
        'wrong-key'
      );
      expect((await request.post(delivery.url, delivery)).status()).toBe(401);
      const { data } = await db.from('email_suppressions').select('id').eq('email', email);
      expect(data).toEqual([]);
    });

    test('refuses a wrong URL secret', async ({ request }) => {
      const { headers, data } = mailchimpDelivery({
        type: 'unsubscribe',
        'data[email]': 'x@e2e.test',
      });
      const response = await request.post('/api/webhooks/mailchimp?secret=wrong', {
        headers,
        data,
      });
      expect(response.status()).toBe(401);
    });
  });

  test.describe('Resend', () => {
    test('a hard bounce suppresses the address', async ({ request, db }, testInfo) => {
      const email = uniqueEmail(testInfo, 'bounce');
      const delivery = resendDelivery({
        type: 'email.bounced',
        created_at: new Date().toISOString(),
        data: { email_id: 'e2e', to: [email], bounce: { type: 'Permanent' } },
      });
      expect((await request.post('/api/webhooks/resend', delivery)).status()).toBe(200);

      const { data, error } = await db
        .from('email_suppressions')
        .select('reason, source')
        .eq('email', email);
      expect(error).toBeNull();
      expect(data).toEqual([{ reason: 'bounce', source: 'resend-webhook' }]);
      await expectUnsubscribeMirrored(email);
    });

    test('refuses a bad signature', async ({ request }) => {
      const delivery = resendDelivery(
        { type: 'email.bounced', data: { to: ['x@e2e.test'] } },
        `whsec_${Buffer.from('wrong-key').toString('base64')}`
      );
      expect((await request.post('/api/webhooks/resend', delivery)).status()).toBe(401);
    });
  });

  test.describe('cron tick', () => {
    const cronAuth = { authorization: `Bearer ${SECRETS.cron}` };

    /** Every job the tick runs, in order (src/lib/cron/jobs.ts). */
    const JOBS = [
      'journey-advance',
      'journey-sweeps',
      'journey-advance-new',
      'partner-maintenance',
      'referral-maintenance',
      'sync-shifts',
      'schedule-lint',
      'business-report-sync',
      'business-activity-sync',
      'lost-found-sweep',
      'lost-found-cleanup',
      'board-media-sweep',
      'sop-run-expiry',
      'pyre-agent-routines',
      'weekly-shifts',
      'newsletter-send',
    ];

    /**
     * The skips this environment explains. Anything else (out of time, a
     * query that failed, storage unavailable) means the job didn't do its work.
     */
    const EXPECTED_SKIPS: Record<string, RegExp> = {
      // The report syncs keep their cursor in Redis, which the suite doesn't run.
      'business-report-sync': /^redis-unavailable$/,
      'business-activity-sync': /^redis-unavailable$/,
      // The roundup goes out Monday mornings only, to people with shifts.
      'weekly-shifts': /^(not-monday|before-send-hour|no-shifts)$/,
    };

    type JobResult = Record<string, unknown> & { error?: string; skipped?: string };

    test('refuses a caller without the secret', async ({ request }) => {
      expect((await request.get('/api/cron/tick?dryRun=1')).status()).toBe(401);
    });

    test('a dry run runs every job, and each reports what it would do', async ({ request }) => {
      const response = await request.get('/api/cron/tick?dryRun=1', {
        headers: cronAuth,
        timeout: 60_000,
      });
      expect(response.status()).toBe(200);
      const body = (await response.json()) as { dryRun: boolean; jobs: Record<string, JobResult> };
      expect(body.dryRun).toBe(true);
      expect(Object.keys(body.jobs)).toEqual(JOBS);

      const failed = Object.entries(body.jobs).filter(([, result]) => result.error);
      expect(failed, 'jobs that failed').toEqual([]);
      const unexplained = Object.entries(body.jobs)
        .filter(([name, result]) => result.skipped && !EXPECTED_SKIPS[name]?.test(result.skipped))
        .map(([name, result]) => `${name}: ${result.skipped}`);
      expect(unexplained, 'jobs that skipped their work').toEqual([]);

      // The ones that did work say so in their own terms, and wrote nothing.
      const { jobs } = body;
      expect(jobs['partner-maintenance']).toMatchObject({
        expired: 0,
        wouldExpire: expect.any(Array),
        reconciliationSkipped: expect.arrayContaining([`${PARTNER.slug}:reconciliation-off`]),
      });
      expect(jobs['referral-maintenance']).toMatchObject({
        wouldConvert: expect.any(Array),
        wouldExpireRedemptions: expect.any(Array),
      });
      // Dry-run counts are what the job would do; the tick writes nothing.
      expect(jobs['sync-shifts']).toMatchObject({
        dryRun: true,
        created: expect.any(Number),
        updated: expect.any(Number),
      });
      expect(jobs['schedule-lint']).toMatchObject({ trigger: 'dry-run', sent: 0 });
      expect(jobs['sop-run-expiry']).toMatchObject({ dryRun: true, abandoned: expect.any(Number) });
      for (const name of ['lost-found-sweep', 'lost-found-cleanup', 'board-media-sweep']) {
        expect(jobs[name], name).toMatchObject({ dryRun: true });
      }
      expect(jobs['journey-advance']).toMatchObject({ sent: 0, wouldSend: expect.any(Array) });
      expect(jobs['newsletter-send']).toMatchObject({ dryRun: true, issues: expect.any(Array) });
    });

    test('partner maintenance expires a request nobody answered, and tells the customer', async ({
      request,
      db,
    }, testInfo) => {
      const email = uniqueEmail(testInfo, 'stale-partner');
      const { error } = await db.from('partner_verifications').insert({
        partner_slug: PARTNER.slug,
        customer_first_name: 'Sol',
        customer_last_name: 'Stale',
        customer_email: email,
        customer_phone: '8045550199',
        created_at: new Date(Date.now() - 30 * 24 * 3600_000).toISOString(),
      });
      expect(error).toBeNull();
      const status = async () => {
        const { data, error: readError } = await db
          .from('partner_verifications')
          .select('status, decided_by')
          .eq('customer_email', email)
          .single();
        expect(readError).toBeNull();
        return data;
      };
      const tick = async (dryRun: boolean) => {
        const response = await request.get(
          `/api/cron/tick?job=partner-maintenance${dryRun ? '&dryRun=1' : ''}`,
          { headers: cronAuth, timeout: 60_000 }
        );
        expect(response.status()).toBe(200);
        return ((await response.json()) as { jobs: Record<string, JobResult> }).jobs[
          'partner-maintenance'
        ];
      };

      // A dry run names it and leaves it be.
      expect((await tick(true)).wouldExpire).toContain(`${PARTNER.slug}:${email}`);
      expect(await status()).toEqual({ status: 'pending', decided_by: null });

      const result = await tick(false);
      expect(result.error).toBeUndefined();
      expect(result.expired).toBeGreaterThanOrEqual(1);
      expect(await status()).toEqual({ status: 'expired', decided_by: 'cron' });
      expect(await emailsTo(email, 'partner-denied')).toHaveLength(1);

      // The next tick has nothing left to do for it.
      await tick(false);
      expect(await emailsTo(email, 'partner-denied')).toHaveLength(1);
    });
  });
});
