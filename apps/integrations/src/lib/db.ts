import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Service-role Supabase client for durable engine state (journey enrollments,
// the email send log, and the suppression list — see the email_marketing
// migration in apps/supabase). Server-side only: the service-role key bypasses
// RLS and must never reach a client bundle.
//
// Like getRedis()/getResend(), returns null when unconfigured so callers can
// degrade gracefully instead of crashing the webhook path.

export interface JourneyEnrollmentRow {
  id: string;
  journey_id: string;
  member_id: number;
  email: string;
  step: number;
  next_at: string | null;
  status: 'active' | 'completed' | 'exited';
  exit_reason: string | null;
  enrolled_at: string;
  updated_at: string;
}

export interface EmailSendRow {
  id: string;
  email: string;
  member_id: number | null;
  template: string;
  kind: 'transactional' | 'marketing';
  journey_id: string | null;
  step_id: string | null;
  campaign: string | null;
  send_key: string | null;
  resend_id: string | null;
  status: 'sent' | 'skipped' | 'suppressed' | 'failed';
  error: string | null;
  sent_at: string;
}

// A reciprocal-discount partner. Managed from /admin/partners and read through
// the cached registry in lib/partner/registry.ts.
export interface PartnerRow {
  id: string;
  slug: string;
  name: string;
  tag_name: string;
  discount_percent: number;
  /** Everyone who receives the confirm/deny email; empty = not yet configured. */
  contact_emails: string[];
  /** Overrides the global PARTNER_CC_EMAIL when set. */
  cc_email: string | null;
  enabled: boolean;
  decision_expiry_days: number;
  reconciliation_enabled: boolean;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PartnerVerificationRow {
  id: string;
  partner_slug: string;
  customer_first_name: string;
  customer_last_name: string;
  customer_email: string;
  partner_member_email: string | null;
  customer_phone: string | null;
  status: 'pending' | 'confirmed' | 'denied' | 'expired' | 'revoked';
  momence_member_id: number | null;
  decided_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  /** null = partner link click, an email = admin action, 'cron' = expiry sweep. */
  decided_by: string | null;
  /** Partner contacts the request email actually reached; 0 = nobody. */
  notified_count: number;
  last_notified_at: string | null;
  created_at: string;
  updated_at: string;
}

// A referral tier: which Momence tag (and therefore which manually-created
// Price Rule) a given percent maps to. Managed from /admin/referrals.
export interface ReferralTierRow {
  percent: number;
  tag_name: string;
  enabled: boolean;
  created_at: string;
}

// A referrer — an individual member or a partner business — and their
// personalized code. Read through the cached registry in lib/referral/registry.ts.
export interface ReferrerRow {
  id: string;
  referrer_type: 'member' | 'partner';
  momence_member_id: number | null;
  partner_slug: string | null;
  email: string | null;
  display_name: string;
  code: string;
  discount_percent: number;
  enabled: boolean;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReferralRedemptionRow {
  id: string;
  referrer_id: string;
  code: string;
  discount_percent: number;
  tag_name: string;
  friend_first_name: string;
  friend_last_name: string;
  friend_email: string;
  friend_momence_member_id: number | null;
  status: 'pending' | 'redeemed' | 'converted' | 'expired' | 'revoked';
  discount_tag_removed_at: string | null;
  converted_session_id: number | null;
  converted_session_booking_id: number | null;
  converted_at: string | null;
  cancelled_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  /** null = system, an email = admin action, 'cron' = maintenance sweep. */
  decided_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReferralRewardRow {
  id: string;
  referrer_id: string;
  redemption_id: string;
  reward_tag_name: string;
  status: 'granted' | 'consumed' | 'expired' | 'revoked';
  granted_at: string;
  consumed_at: string | null;
  consumed_session_booking_id: number | null;
  reward_tag_removed_at: string | null;
  decided_by: string | null;
  created_at: string;
  updated_at: string;
}

// One chemical actually added to a tub with a water_tests entry. `grams` is
// what went in the water; `recommended_grams` is what the dosing chart said,
// so deviations stay auditable in the log.
export interface DoseRecord {
  chemical: string;
  grams: number;
  reason?: string;
  recommended_grams?: number;
}

export interface WaterTestRow {
  id: string;
  tub: 'left' | 'right';
  entry_type: 'test' | 'shock' | 'refill';
  ta_ppm: number | null;
  ph: number | null;
  /** Free chlorine (FC) — the active sanitizer; the 1–3 ppm target. */
  free_chlorine_ppm: number | null;
  /** Combined chlorine (CC) — spent sanitizer; high CC means shock. */
  combined_chlorine_ppm: number | null;
  salt_ppm: number | null;
  test_method: 'strips' | 'digital_meter' | 'tf_pro_salt' | null;
  doses: DoseRecord[];
  notes: string | null;
  recorded_by: string;
  created_at: string;
  updated_at: string;
}

// Staff scheduling row types live in @pyre/schedule-core (shared with the
// agents app); re-exported here so app code keeps one import for row shapes.
export type {
  ScheduleProposalRow,
  ShiftAssignmentRow,
  ShiftRequestRow,
  ShiftRow,
  StaffRow,
  SubRequestRow,
  TimeOffRow,
} from '@pyre/schedule-core';

export interface EmailSuppressionRow {
  id: string;
  email: string;
  reason: 'unsubscribe' | 'complaint' | 'bounce' | 'momence' | 'manual';
  source: string | null;
  created_at: string;
}

// Delivery-gate overrides managed from /admin/email-templates and read through
// the cached gate in lib/email/dev-mode.ts. No row = env decides.
export interface EmailTemplateOverrideRow {
  template: string;
  live: boolean;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailWhitelistRow {
  email: string;
  added_by: string | null;
  created_at: string;
}

let client: SupabaseClient | null | undefined;

export function getDb(): SupabaseClient | null {
  if (client !== undefined) return client;

  const url = import.meta.env.SUPABASE_URL;
  // Prefer the revocable sb_secret_* key; SUPABASE_SERVICE_ROLE_KEY is the
  // legacy fallback until it's removed from the environment.
  const secretKey =
    import.meta.env.SUPABASE_SECRET_KEY ?? import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !secretKey) {
    console.warn('[DB] Supabase not configured (SUPABASE_URL / SUPABASE_SECRET_KEY)');
    client = null;
    return client;
  }

  client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
