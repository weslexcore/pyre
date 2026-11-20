// Shared by the referral specs: a referrer of the test's own (a Momence
// member with a code), and the landing page's server-side calls to this app.

import type { APIRequestContext, TestInfo } from '@playwright/test';
import { uniqueEmail } from '@pyre/e2e-utils';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SECRETS } from './env';
import { momence } from './momence';
import { REFERRAL_TIER } from './partners';
import { expect } from './test';

/** The tag a referrer's reward rides on (REFERRAL_REWARD_TAG_NAME in env.ts). */
export const REWARD_TAG = 'referral-reward';

export const referralAuth = { authorization: `Bearer ${SECRETS.referral}` };

export interface SeededReferrer {
  id: string;
  code: string;
  email: string;
  memberId: number;
}

/** The Momence tags the program reads, created once (idempotent). */
export async function ensureReferralTags() {
  await momence.addTag(REFERRAL_TIER.tagName);
  await momence.addTag(REWARD_TAG);
}

/** A member referrer with a code no other test uses. */
export async function seedReferrer(
  db: SupabaseClient,
  testInfo: TestInfo,
  { enabled = true }: { enabled?: boolean } = {}
): Promise<SeededReferrer> {
  const email = uniqueEmail(testInfo, 'referrer');
  const { id: memberId } = await momence.addMember({
    firstName: 'Rae',
    lastName: 'Referrer',
    email,
  });
  const code = `E2E${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  const { data, error } = await db
    .from('referrers')
    .insert({
      referrer_type: 'member',
      momence_member_id: memberId,
      email,
      display_name: 'Rae',
      code,
      discount_percent: REFERRAL_TIER.percent,
      enabled,
      created_by: 'e2e',
    })
    .select('id')
    .single();
  expect(error, 'seed referrer').toBeNull();
  return { id: (data as { id: string }).id, code, email, memberId };
}

export interface Friend {
  firstName: string;
  lastName: string;
  email: string;
}

export function friendFor(testInfo: TestInfo, label = 'friend'): Friend {
  return { firstName: 'Fran', lastName: 'Friend', email: uniqueEmail(testInfo, label) };
}

/** The landing page's redemption call (POST /api/referral/redeem). */
export function redeem(request: APIRequestContext, code: string, friend: Friend) {
  return request.post('/api/referral/redeem', {
    headers: referralAuth,
    data: { code, ...friend },
  });
}

export interface RedemptionRow {
  id: string;
  status: string;
  friend_momence_member_id: string | null;
  converted_session_booking_id: string | null;
  cancelled_at: string | null;
}

/** Every redemption filed for a friend's email. */
export async function redemptionsFor(db: SupabaseClient, email: string): Promise<RedemptionRow[]> {
  const { data, error } = await db
    .from('referral_redemptions')
    .select('id, status, friend_momence_member_id, converted_session_booking_id, cancelled_at')
    .eq('friend_email', email);
  expect(error).toBeNull();
  return (data ?? []) as RedemptionRow[];
}
