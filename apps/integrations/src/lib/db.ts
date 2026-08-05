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

export interface PartnerVerificationRow {
  id: string;
  partner_slug: string;
  customer_first_name: string;
  customer_last_name: string;
  customer_email: string;
  partner_member_email: string | null;
  customer_phone: string | null;
  status: 'pending' | 'confirmed' | 'denied' | 'expired';
  momence_member_id: number | null;
  decided_at: string | null;
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

// Staff scheduling rows (see the staff_scheduling migration and
// docs/staff-scheduling-scope.md). Dates are YYYY-MM-DD and times are local
// wall-clock 'HH:MM:SS' strings — America/New_York, never UTC.

export interface ScheduleStaffRow {
  id: string;
  display_name: string;
  /** Join key against the Momence OAuth profile email; null until confirmed. */
  momence_email: string | null;
  role: 'admin' | 'staff';
  is_founder: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ShiftRow {
  id: string;
  shift_date: string;
  label: string;
  starts_at: string;
  ends_at: string;
  staff_needed: number;
  source: 'momence' | 'manual';
  momence_session_ids: Array<{ type: string; id: number }>;
  sync_locked: boolean;
  notes: string | null;
  status: 'active' | 'cancelled';
  created_at: string;
  updated_at: string;
}

export interface ShiftAssignmentRow {
  id: string;
  shift_id: string;
  staff_id: string;
  starts_at: string;
  ends_at: string;
  role: 'full' | 'setup' | 'partial';
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimeOffRow {
  id: string;
  staff_id: string;
  kind: 'range' | 'recurring';
  start_date: string | null;
  end_date: string | null;
  /** 0 = Sunday .. 6 = Saturday (matches JS Date.getDay()). */
  days_of_week: number[];
  starts_at: string | null;
  ends_at: string | null;
  note: string | null;
  created_by: 'staff' | 'admin';
  created_at: string;
  updated_at: string;
}

export interface EmailSuppressionRow {
  id: string;
  email: string;
  reason: 'unsubscribe' | 'complaint' | 'bounce' | 'momence' | 'manual';
  source: string | null;
  created_at: string;
}

let client: SupabaseClient | null | undefined;

export function getDb(): SupabaseClient | null {
  if (client !== undefined) return client;

  const url = import.meta.env.SUPABASE_URL;
  // Prefer the revocable sb_secret_* key; SUPABASE_SERVICE_ROLE_KEY is the
  // legacy fallback until it's removed from the environment.
  const secretKey = import.meta.env.SUPABASE_SECRET_KEY ?? import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

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
