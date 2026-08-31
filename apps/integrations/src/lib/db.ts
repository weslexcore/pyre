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
  ScheduleDraftMessageRow,
  ScheduleProposalRow,
  ShiftAssignmentRow,
  ShiftRequestRow,
  ShiftRow,
  StaffRow,
  StaffStipendRow,
  StipendOverrideRow,
  SubRequestRow,
  TimeOffRow,
} from '@pyre/schedule-core';

/**
 * Blank the personal calendar-feed secret before a roster row goes out in a
 * response. That token is the entire auth gate on someone's shift feed, so it
 * only ever travels back to its own owner (via /api/admin/calendar-feed) —
 * not to teammates and not to admins. Call this on every path that serializes
 * `staff` rows.
 */
export function redactCalendarToken<T extends { calendar_token?: string | null }>(row: T): T {
  return { ...row, calendar_token: null };
}

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

// Per-journey pause switch managed from /admin/email-templates and read
// through the cached settings in lib/email/journeys/settings.ts. No row =
// enabled.
export interface JourneySettingRow {
  journey_id: string;
  enabled: boolean;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

// Raw Momence report-run results, one row per (report type, ET day), written
// by the business-report-sync cron job. raw_items is kept verbatim so
// normalization can be re-run without re-spending the API's report budget.
export interface MomenceReportSnapshotRow {
  id: string;
  report_type: string;
  snapshot_date: string;
  range_from: string;
  range_to: string;
  report_run_id: number | null;
  raw_items: unknown[];
  item_count: number;
  normalize_status: 'ok' | 'empty' | 'parse-partial';
  created_at: string;
}

// The normalized daily series /admin/business reads (ET calendar days).
export interface BusinessMetricRow {
  metric_date: string;
  metric: string;
  value: number;
  source_report_type: string;
  snapshot_date: string;
  updated_at: string;
}

// A standard operating procedure document on /admin/sops (see the sops
// migration). Access-tier semantics live in lib/sops/levels.ts.
export interface SopRow {
  id: string;
  slug: string;
  title: string;
  content_md: string;
  category: string;
  // Who may read and who may save, each as a set of roles plus a set of
  // individually named staff emails (see lib/sops/levels.ts). Roles are a set,
  // not a tier floor.
  view_roles: ('staff' | 'shift_lead' | 'admin')[];
  edit_roles: ('staff' | 'shift_lead' | 'admin')[];
  view_emails: string[];
  edit_emails: string[];
  sort_order: number;
  archived: boolean;
  current_version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

// One save of an SOP: full snapshot + who/when + optional change note.
export interface SopVersionRow {
  id: string;
  sop_id: string;
  version: number;
  title: string;
  content_md: string;
  edited_by: string;
  change_note: string | null;
  created_at: string;
}

// Display order for SOP categories on /admin/sops (name matches the free-text
// sops.category; unranked categories sort last).
export interface SopCategoryRow {
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// One execution of a checklist SOP (see the sop_runs migration): who
// started/ended it, when, against which document version.
export interface SopRunRow {
  id: string;
  sop_id: string;
  sop_version: number;
  task_count: number;
  status: 'in_progress' | 'completed' | 'abandoned';
  started_by: string;
  started_at: string;
  ended_by: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

// One checked task item within a run; unchecking deletes the row.
export interface SopRunCheckRow {
  id: string;
  run_id: string;
  item_index: number;
  item_text: string;
  checked_by: string;
  checked_at: string;
}

// One shift-lead note about how a shift went (see the shift_notes migration).
// Keyed by the shift's wall-clock date rather than a shifts row, so notes
// survive schedule resyncs and can cover days the board never held.
export interface ShiftNoteRow {
  id: string;
  /** YYYY-MM-DD, local wall-clock America/New_York. */
  note_date: string;
  body: string;
  author_email: string;
  /** Session email of the last editor (author or admin); null until edited. */
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

// A photo/video/document backing a shift note (see the shift-note media
// migration). Objects live in the private shift-note-media bucket and are
// served via signed URLs minted by /api/admin/shift-note-media.
export interface ShiftNoteAttachmentRow {
  id: string;
  note_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  kind: 'photo' | 'video' | 'document';
  uploaded_by: string;
  created_at: string;
}

// A bathhouse incident report (see the incidents migration). The taxonomy —
// categories, severities, areas, contributing factors — lives in
// lib/incidents/types.ts, which the table's check constraints mirror.
export interface IncidentRow {
  id: string;
  /** Human-quotable case number, generated by the database: INC-2026-0001. */
  reference: string;
  status: 'submitted' | 'under_review' | 'action_required' | 'resolved' | 'closed' | 'voided';
  category: string;
  severity: 'near_miss' | 'minor' | 'moderate' | 'severe' | 'critical';
  occurred_at: string;
  discovered_at: string | null;
  area: string;
  area_detail: string | null;
  /** AffectedPerson[] from lib/incidents/types.ts. */
  affected_people: unknown[];
  /** Witness[] from lib/incidents/types.ts. */
  witnesses: unknown[];
  staff_present: string[];
  description: string;
  immediate_actions: string;
  first_aid_given: boolean;
  first_aid_by: string | null;
  ems_called: boolean;
  ems_called_at: string | null;
  police_called: boolean;
  transported_to_hospital: boolean;
  treatment_refused: boolean;
  guest_left_premises: boolean | null;
  guest_informed_of_report: boolean | null;
  contributing_factors: string[];
  equipment_involved: string | null;
  sauna_temp_f: number | null;
  water_temp_f: number | null;
  follow_up_required: boolean;
  follow_up_notes: string | null;
  corrective_actions: string | null;
  resolution_notes: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  /** Session email of whoever filed it — never a value from the request body. */
  reported_by: string;
  reported_by_name: string | null;
  reported_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

// A photo, video, or document on an incident report. Objects live in the
// private incident-media bucket; storage_path is only ever exchanged for a
// short-lived signed URL by /api/admin/incident-media.
export interface IncidentAttachmentRow {
  id: string;
  incident_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  kind: 'photo' | 'video' | 'document';
  caption: string | null;
  uploaded_by: string;
  created_at: string;
}

// One entry in an incident's append-only audit trail.
export interface IncidentEventRow {
  id: string;
  incident_id: string;
  action:
    | 'created'
    | 'updated'
    | 'status_changed'
    | 'note_added'
    | 'attachment_added'
    | 'attachment_removed'
    | 'notified';
  actor: string;
  detail: Record<string, unknown>;
  note: string | null;
  created_at: string;
}

// OAuth tokens for a connected QuickBooks Online company (see the
// quickbooks_tokens migration and lib/quickbooks). Refresh tokens rotate on
// every refresh, so this row is rewritten each time; service-role only —
// tokens never travel to a browser.
export interface QuickBooksTokenRow {
  realm_id: string;
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
  refresh_token_expires_at: string;
  environment: 'sandbox' | 'production';
  connected_by: string | null;
  created_at: string;
  updated_at: string;
}

// An admin-entered operating cost on /admin/business (see the business_costs
// migration). `amount` means dollars-per-cadence, total dollars, dollars per
// open hour, or a percent of revenue depending on `kind`; the amortization
// math lives in lib/business/costs.ts.
export interface BusinessCostRow {
  id: string;
  name: string;
  category: 'rent' | 'software' | 'supplies' | 'services' | 'fees' | 'other';
  kind: 'recurring' | 'one_off' | 'per_open_hour' | 'percent_of_revenue';
  amount: number;
  cadence: 'weekly' | 'biweekly' | 'monthly' | 'yearly' | null;
  monthly_cap: number | null;
  incurred_on: string | null;
  effective_from: string | null;
  effective_to: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
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
